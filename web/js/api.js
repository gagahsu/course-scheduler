// 所有資料存取集中在這裡；畫面程式只呼叫這些函式
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// 把 PostgREST / 資料庫錯誤轉成看得懂的中文
function friendly(error) {
  const m = error.message || String(error);
  if (error.code === 'P0001') return m;                                   // 我們自己 raise 的訊息
  if (error.code === 'PGRST116') return '找不到這筆資料，可能已經被刪除';    // .single() 查到 0 筆
  if (m.includes('teaching_blocks_no_overlap')) return '這段期間已經有其他老師負責這個班，請先調整原本的區段';
  if (m.includes('class_assistants_no_overlap')) return '這位老師在這段期間已經是這個班的助教';
  if (m.includes('leaves_no_overlap')) return '這位老師在這段期間已經有請假紀錄';
  if (m.includes('substitutions_class_id_day_key')) return '這一天已經有代課紀錄了';
  if (m.includes('courses_name_key')) return '已經有同名的課程';
  if (m.includes('curricula_name_key')) return '已經有同名的課表範本';
  if (m.includes('teachers_name_key')) return '已經有同名的老師';
  if (m.includes('violates foreign key')) return '還有其他資料用到它，不能刪除';
  if (m.includes('JWT') || error.status === 401) return '登入已過期，請重新整理頁面';
  return m;
}
async function run(q) {
  const { data, error } = await q;
  if (error) throw new Error(friendly(error));
  return data;
}

// ---------- 讀取 ----------
export const listTeachers = () => run(sb.from('teachers').select('*').order('id'));
export const listLocations = () => run(sb.from('locations').select('*').order('id'));
// pub：公開行事曆（沒登入）只能讀部分欄位，不能用 select('*')
const PUB_CLASS = 'id, name, term, location_id, room, start_date, end_date';
export const listClasses = (pub = false) =>
  run(sb.from('classes').select(`${pub ? PUB_CLASS : '*'}, locations(name)`).order('start_date'));
export const getClass = (id) =>
  run(sb.from('classes').select('*, locations(name)').eq('id', id).single());
export const listBlocks = (classId) =>
  run(sb.from('teaching_blocks').select('*').eq('class_id', classId).order('start_date'));
export const listSessions = (from, to, filters = {}) => {
  let q = sb.from('v_sessions').select('*').gte('day', from).lte('day', to);
  if (filters.classId) q = q.eq('class_id', filters.classId);
  if (filters.plannedTeacherId) q = q.eq('planned_teacher_id', filters.plannedTeacherId);
  return run(q.order('day').order('class_id').limit(5000));
};
export const listSessionsByLeaves = (leaveIds) => leaveIds.length
  ? run(sb.from('v_sessions').select('*').in('leave_id', leaveIds).order('day'))
  : Promise.resolve([]);
export const listUncovered = (from, limit = 50) =>
  run(sb.from('v_uncovered').select('*').gte('day', from).order('day').limit(limit));
export const listEvents = (from, to) =>
  run(sb.from('calendar_events').select('*').gte('day', from).lte('day', to).order('day'));
export const listLeaves = (from, to, pub = false) => {
  let q = sb.from('leaves').select(pub ? 'id, teacher_id, start_date, end_date' : '*, substitutions(*)').order('start_date', { ascending: false });
  if (from) q = q.gte('end_date', from);
  if (to) q = q.lte('start_date', to);
  return run(q);
};
export const listConflicts = (from, to) =>
  run(sb.from('v_teacher_conflicts').select('*').gte('day', from).lte('day', to));
export const teacherDayStatus = (day) => run(sb.rpc('teacher_day_status', { p_day: day }));

// ---------- 寫入 ----------
// id 是 generated always identity，update 時不能把 id 一起送出去
const update = (table, { id, ...row }) => run(sb.from(table).update(row).eq('id', id).select().single());
export const registerLeave = (p) => run(sb.rpc('register_leave', {
  p_teacher_id: p.teacherId, p_start: p.start, p_end: p.end,
  p_type: p.type, p_note: p.note || null, p_subs: p.subs || [],
}));
export const deleteLeave = (id) => run(sb.from('leaves').delete().eq('id', id));
export const addSubstitution = (row) => run(sb.from('substitutions').insert(row).select().single());
export const deleteSubstitution = (id) => run(sb.from('substitutions').delete().eq('id', id));
// 某班一段期間的代課全部取消
export const deleteSubstitutionsInRange = (classId, from, to) =>
  run(sb.from('substitutions').delete().eq('class_id', classId).gte('day', from).lte('day', to));
// 區間調整：這班 from–to 改由 teacherId 上課；他在別班的課由 backfillId 接手（同一個交易）
export const assignRange = (p) => run(sb.rpc('assign_range', {
  p_class_id: p.classId, p_from: p.from, p_to: p.to, p_teacher_id: p.teacherId,
  p_backfill_id: p.backfillId ?? null, p_note: p.note || null,
}));
// 每位老師每天在哪個班（主授／代課／助教）
export const listPresence = (from, to) =>
  run(sb.from('v_presence').select('*').gte('day', from).lte('day', to).limit(5000));

export const saveClass = (row) => row.id
  ? update('classes', row)
  : run(sb.from('classes').insert(row).select().single());
export const deleteClass = (id) => run(sb.from('classes').delete().eq('id', id));

export const saveBlock = (row) => row.id
  ? update('teaching_blocks', row)
  : run(sb.from('teaching_blocks').insert(row).select().single());
export const deleteBlock = (id) => run(sb.from('teaching_blocks').delete().eq('id', id));

// 助教／協同老師：同一天可以有多位，和主授老師一起在場
export const listAssistants = (classId) =>
  run(sb.from('class_assistants').select('*').eq('class_id', classId).order('start_date').order('teacher_id'));
export const saveAssistant = (row) => row.id
  ? update('class_assistants', row)
  : run(sb.from('class_assistants').insert(row).select().single());
export const deleteAssistant = (id) => run(sb.from('class_assistants').delete().eq('id', id));
// 某位老師在這段期間擔任助教的課（請假時提示，不需要代課）
export const listAssistingSessions = (teacherId, from, to) =>
  run(sb.from('v_sessions').select('*').gte('day', from).lte('day', to)
    .or(`assistant_ids.cs.{${teacherId}},absent_assistant_ids.cs.{${teacherId}}`).order('day'));

export const saveTeacher = (row) => row.id
  ? update('teachers', row)
  : run(sb.from('teachers').insert(row).select().single());
export const deleteTeacher = (id) => run(sb.from('teachers').delete().eq('id', id));

// ---------- 課程、老師專長、課表範本 ----------
export const listCourses = () => run(sb.from('courses').select('*').order('id'));
export const saveCourse = (row) => row.id
  ? update('courses', row)
  : run(sb.from('courses').insert(row).select().single());
export const deleteCourse = (id) => run(sb.from('courses').delete().eq('id', id));

export const listTeacherCourses = () => run(sb.from('teacher_courses').select('*'));
// 整批換掉某位老師會教的課 / 某門課的授課老師
export async function setTeacherCourses(teacherId, courseIds) {
  await run(sb.from('teacher_courses').delete().eq('teacher_id', teacherId));
  if (courseIds.length) await run(sb.from('teacher_courses').insert(courseIds.map((c) => ({ teacher_id: teacherId, course_id: c }))));
}
export async function setCourseTeachers(courseId, teacherIds) {
  await run(sb.from('teacher_courses').delete().eq('course_id', courseId));
  if (teacherIds.length) await run(sb.from('teacher_courses').insert(teacherIds.map((t) => ({ teacher_id: t, course_id: courseId }))));
}

export const listCurricula = () =>
  run(sb.from('curricula').select('*, curriculum_items(*)').order('id').order('position', { referencedTable: 'curriculum_items' }));
export const saveCurriculum = (p) => run(sb.rpc('save_curriculum', {
  p_id: p.id ?? null, p_name: p.name, p_note: p.note || null, p_items: p.items,
}));
export const deleteCurriculum = (id) => run(sb.from('curricula').delete().eq('id', id));
// 依上課日把排課列依序排成授課區段
export const applyPlan = (classId, items, replace) =>
  run(sb.rpc('apply_plan', { p_class_id: classId, p_items: items, p_replace: replace }));

export const addEvents = (rows) => run(sb.from('calendar_events').insert(rows).select());
// 台灣國定假日（人事行政總處行事曆，經 github.com/ruyut/TaiwanCalendar 整理成 JSON）
// holidays：平日的放假日（週末本來就不上課）；workdays：週末補班日
// 回傳 { holidays: [{ day: 'YYYY-MM-DD', title }], workdays: [...] }
export async function fetchTaiwanCalendar(year) {
  const res = await fetch(`https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`);
  if (res.status === 404) throw new Error(`${year} 年的行事曆還沒公布（通常在前一年 6 月左右）`);
  if (!res.ok) throw new Error(`讀取 ${year} 年行事曆失敗（${res.status}）`);
  const all = await res.json();
  // 「補假」補上是哪個節日的補假（前後 3 天內最近的節日）
  const named = (i) => {
    for (let k = 1; k <= 3; k++) for (const j of [i - k, i + k]) {
      const n = all[j]?.description;
      if (n && n !== '補假') return n;
    }
    return '';
  };
  const day = (d) => `${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}`;
  const weekend = (d) => d.week === '六' || d.week === '日';
  const rows = all.map((d, i) => ({ d, i }));
  return {
    holidays: rows.filter(({ d }) => d.isHoliday && !weekend(d)).map(({ d, i }) => ({
      day: day(d), title: d.description === '補假' && named(i) ? `補假（${named(i)}）` : d.description || '放假',
    })),
    workdays: rows.filter(({ d }) => !d.isHoliday && weekend(d)).map(({ d }) => ({ day: day(d), title: d.description || '補班' })),
  };
}
export const addEvent = (row) => run(sb.from('calendar_events').insert(row).select().single());
export const deleteEvent = (id) => run(sb.from('calendar_events').delete().eq('id', id));
export const updateEvent = (row) => update('calendar_events', row);
