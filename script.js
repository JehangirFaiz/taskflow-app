// ===========================================================
// Taskflow — advanced task manager
// Data persists in localStorage. No external dependencies.
// ===========================================================

const STORAGE_KEY = "taskflow_tasks_v1";

let tasks = [];
let activeFilter = { type: "priority", value: "all" };
let searchQuery = "";
let currentView = "board";
let editingTaskId = null;
let draftSubtasks = [];
let draggedTaskId = null;

// ---------- DOM refs ----------
const colTodo     = document.getElementById("colTodo");
const colProgress = document.getElementById("colProgress");
const colDone      = document.getElementById("colDone");
const listView      = document.getElementById("listView");
const board          = document.getElementById("board");
const emptyState     = document.getElementById("emptyState");
const searchInput    = document.getElementById("searchInput");
const categoryNav    = document.getElementById("categoryNav");
const categoryList   = document.getElementById("categoryList");
const viewToggle      = document.getElementById("viewToggle");

const modalOverlay = document.getElementById("modalOverlay");
const modalTitle   = document.getElementById("modalTitle");
const taskTitleEl  = document.getElementById("taskTitle");
const taskDescEl   = document.getElementById("taskDesc");
const taskPriorityEl = document.getElementById("taskPriority");
const taskDueEl     = document.getElementById("taskDue");
const taskCategoryEl = document.getElementById("taskCategory");
const subtaskListEl  = document.getElementById("subtaskList");
const subtaskInputEl = document.getElementById("subtaskInput");
const deleteTaskBtn   = document.getElementById("deleteTaskBtn");
const toastEl          = document.getElementById("toast");

// ---------- Seed data (first run only) ----------
const SEED_TASKS = [
  { title: "Design homepage hero section", desc: "Explore 2-3 layout directions before picking one.", priority: "high", status: "todo", category: "Design", due: daysFromNow(2), subtasks: [{text:"Moodboard", done:true},{text:"Wireframe", done:false}] },
  { title: "Fix cart quantity bug", desc: "Quantity resets to 1 when page is refreshed.", priority: "high", status: "progress", category: "Development", due: daysFromNow(-1), subtasks: [] },
  { title: "Write blog post on release notes", desc: "", priority: "medium", status: "todo", category: "Marketing", due: daysFromNow(5), subtasks: [] },
  { title: "Set up CI pipeline", desc: "Auto-run tests on every push.", priority: "medium", status: "progress", category: "Development", due: daysFromNow(3), subtasks: [{text:"Choose provider", done:true},{text:"Configure workflow", done:false},{text:"Add badge to README", done:false}] },
  { title: "Client feedback call", desc: "Review the last milestone together.", priority: "low", status: "done", category: "Meetings", due: daysFromNow(-3), subtasks: [] },
  { title: "Update favicon & meta tags", desc: "", priority: "low", status: "done", category: "Design", due: daysFromNow(-5), subtasks: [] },
];

function daysFromNow(n){
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
}

// ---------- Persistence ----------
function loadTasks(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){ tasks = JSON.parse(raw); return; }
  }catch(e){ /* fall through to seed */ }
  tasks = SEED_TASKS.map(t => ({ id: uid(), ...t }));
  saveTasks();
}
function saveTasks(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}
function uid(){
  return "t" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ---------- Toast ----------
let toastTimer;
function showToast(msg){
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2400);
}

// ---------- Helpers ----------
function escapeHtml(str){
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function isOverdue(task){
  if(!task.due || task.status === "done") return false;
  return new Date(task.due + "T23:59:59") < new Date();
}
function formatDue(dateStr){
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function subtaskProgress(task){
  if(!task.subtasks || task.subtasks.length === 0) return null;
  const done = task.subtasks.filter(s => s.done).length;
  return { done, total: task.subtasks.length, pct: Math.round((done/task.subtasks.length)*100) };
}

const dueIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>`;
const checkIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;

// ===========================================================
// Rendering
// ===========================================================
function getFilteredTasks(){
  return tasks.filter(t => {
    if(activeFilter.type === "priority" && activeFilter.value !== "all" && t.priority !== activeFilter.value) return false;
    if(activeFilter.type === "category" && t.category !== activeFilter.value) return false;
    if(searchQuery && !t.title.toLowerCase().includes(searchQuery) && !(t.desc||"").toLowerCase().includes(searchQuery)) return false;
    return true;
  });
}

function renderAll(){
  renderCategories();
  syncFilterUI();
  renderStats();
  if(currentView === "board") renderBoard(); else renderList();
  saveTasks();
}

function renderCategories(){
  const cats = [...new Set(tasks.map(t => t.category).filter(Boolean))].sort();
  categoryNav.innerHTML = `<p class="nav-label">Categories</p>`;
  cats.forEach(cat => {
    const btn = document.createElement("button");
    btn.className = "filter-chip" + (activeFilter.type === "category" && activeFilter.value === cat ? " active" : "");
    btn.innerHTML = `<span class="chip-dot" style="background:var(--blue)"></span>${escapeHtml(cat)}`;
    btn.addEventListener("click", () => {
      activeFilter = { type: "category", value: cat };
      syncFilterUI();
      renderAll();
    });
    categoryNav.appendChild(btn);
  });
  categoryList.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">`).join("");
}

function syncFilterUI(){
  document.querySelectorAll(".filter-chip").forEach(chip => {
    const isMatch = chip.dataset.filterType === activeFilter.type && chip.dataset.filterValue === activeFilter.value;
    const isCatMatch = activeFilter.type === "category" && chip.textContent.trim() === activeFilter.value;
    chip.classList.toggle("active", isMatch || isCatMatch);
  });
}

function renderStats(){
  const total = tasks.length;
  const done = tasks.filter(t => t.status === "done").length;
  const overdue = tasks.filter(isOverdue).length;
  const pct = total === 0 ? 0 : Math.round((done/total)*100);

  document.getElementById("statTotal").textContent = total;
  document.getElementById("statDone").textContent = done;
  document.getElementById("statOverdue").textContent = overdue;
  document.getElementById("ringPercent").textContent = `${pct}%`;

  const circumference = 238.76;
  const offset = circumference - (pct/100)*circumference;
  document.getElementById("ringFill").style.strokeDashoffset = offset;
}

function taskCardHTML(task){
  const prog = subtaskProgress(task);
  const overdue = isOverdue(task);
  return `
    <div class="task-card${task.status==='done' ? ' done-card':''}" draggable="true" data-id="${task.id}">
      <div class="task-top">
        <div class="task-check${task.status==='done' ? ' checked':''}" data-action="toggle-done" data-id="${task.id}">${checkIcon}</div>
        <div class="task-title">${escapeHtml(task.title)}</div>
      </div>
      ${task.desc ? `<div class="task-desc">${escapeHtml(task.desc)}</div>` : ""}
      <div class="task-meta">
        <span class="priority-badge ${task.priority}"><span class="dot"></span>${task.priority}</span>
        ${task.category ? `<span class="category-chip">${escapeHtml(task.category)}</span>` : ""}
        ${task.due ? `<span class="due-chip${overdue ? ' overdue':''}">${dueIcon}${formatDue(task.due)}</span>` : ""}
      </div>
      ${prog ? `<div class="subtask-progress"><div class="subtask-bar"><div class="subtask-bar-fill" style="width:${prog.pct}%"></div></div><span>${prog.done}/${prog.total}</span></div>` : ""}
    </div>
  `;
}

function renderBoard(){
  board.hidden = false;
  listView.hidden = true;
  const filtered = getFilteredTasks();

  const groups = { todo: [], progress: [], done: [] };
  filtered.forEach(t => groups[t.status]?.push(t));

  colTodo.innerHTML = groups.todo.map(taskCardHTML).join("");
  colProgress.innerHTML = groups.progress.map(taskCardHTML).join("");
  colDone.innerHTML = groups.done.map(taskCardHTML).join("");

  document.getElementById("countTodo").textContent = groups.todo.length;
  document.getElementById("countProgress").textContent = groups.progress.length;
  document.getElementById("countDone").textContent = groups.done.length;

  emptyState.hidden = filtered.length > 0;
  attachCardListeners();
  attachDragListeners();
}

function renderList(){
  board.hidden = true;
  listView.hidden = false;
  const filtered = getFilteredTasks();
  const statusLabel = { todo: "To Do", progress: "In Progress", done: "Done" };

  listView.innerHTML = filtered.map(task => {
    const overdue = isOverdue(task);
    return `
      <div class="list-row" data-id="${task.id}">
        <div class="task-check${task.status==='done' ? ' checked':''}" data-action="toggle-done" data-id="${task.id}">${checkIcon}</div>
        <span class="task-title">${escapeHtml(task.title)}</span>
        <span class="priority-badge ${task.priority}"><span class="dot"></span>${task.priority}</span>
        ${task.category ? `<span class="category-chip">${escapeHtml(task.category)}</span>` : ""}
        ${task.due ? `<span class="due-chip${overdue ? ' overdue':''}">${dueIcon}${formatDue(task.due)}</span>` : ""}
        <span class="list-status-tag">${statusLabel[task.status]}</span>
      </div>
    `;
  }).join("");

  emptyState.hidden = filtered.length > 0;

  listView.querySelectorAll(".list-row").forEach(row => {
    row.addEventListener("click", (e) => {
      if(e.target.closest('[data-action="toggle-done"]')) return;
      openModal(row.dataset.id);
    });
  });
  listView.querySelectorAll('[data-action="toggle-done"]').forEach(el => {
    el.addEventListener("click", (e) => { e.stopPropagation(); toggleDone(el.dataset.id); });
  });
}

function attachCardListeners(){
  document.querySelectorAll(".task-card").forEach(card => {
    card.addEventListener("click", (e) => {
      if(e.target.closest('[data-action="toggle-done"]')) return;
      openModal(card.dataset.id);
    });
  });
  document.querySelectorAll('[data-action="toggle-done"]').forEach(el => {
    el.addEventListener("click", (e) => { e.stopPropagation(); toggleDone(el.dataset.id); });
  });
}

function toggleDone(id){
  const task = tasks.find(t => t.id === id);
  if(!task) return;
  task.status = task.status === "done" ? "todo" : "done";
  renderAll();
  showToast(task.status === "done" ? "Task completed 🎉" : "Task reopened");
}

// ===========================================================
// Drag & drop between columns
// ===========================================================
function attachDragListeners(){
  document.querySelectorAll(".task-card").forEach(card => {
    card.addEventListener("dragstart", () => {
      draggedTaskId = card.dataset.id;
      setTimeout(() => card.classList.add("dragging"), 0);
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      draggedTaskId = null;
    });
  });

  document.querySelectorAll(".column-body").forEach(col => {
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      col.classList.add("drag-over");
    });
    col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("drag-over");
      if(!draggedTaskId) return;
      const task = tasks.find(t => t.id === draggedTaskId);
      if(task){
        task.status = col.dataset.status;
        renderAll();
      }
    });
  });
}

// ===========================================================
// Filters, search, view toggle
// ===========================================================
document.querySelectorAll('.filter-chip[data-filter-type]').forEach(chip => {
  chip.addEventListener("click", () => {
    activeFilter = { type: chip.dataset.filterType, value: chip.dataset.filterValue };
    syncFilterUI();
    renderAll();
  });
});

searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value.trim().toLowerCase();
  renderAll();
});

viewToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".view-btn");
  if(!btn) return;
  currentView = btn.dataset.view;
  document.querySelectorAll(".view-btn").forEach(b => b.classList.toggle("active", b === btn));
  renderAll();
});

// ===========================================================
// Modal — add / edit task
// ===========================================================
document.getElementById("newTaskBtn").addEventListener("click", () => openModal(null));
document.getElementById("modalClose").addEventListener("click", closeModal);
document.getElementById("cancelBtn").addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => { if(e.target === modalOverlay) closeModal(); });

function openModal(taskId){
  editingTaskId = taskId;
  const task = taskId ? tasks.find(t => t.id === taskId) : null;

  modalTitle.textContent = task ? "Edit Task" : "New Task";
  taskTitleEl.value = task?.title || "";
  taskDescEl.value = task?.desc || "";
  taskPriorityEl.value = task?.priority || "medium";
  taskDueEl.value = task?.due || "";
  taskCategoryEl.value = task?.category || "";
  draftSubtasks = task?.subtasks ? JSON.parse(JSON.stringify(task.subtasks)) : [];
  deleteTaskBtn.hidden = !task;

  renderDraftSubtasks();
  modalOverlay.classList.add("open");
  setTimeout(() => taskTitleEl.focus(), 100);
}

function closeModal(){
  modalOverlay.classList.remove("open");
  editingTaskId = null;
  draftSubtasks = [];
}

function renderDraftSubtasks(){
  subtaskListEl.innerHTML = draftSubtasks.map((s, i) => `
    <div class="subtask-row">
      <input type="checkbox" data-idx="${i}" ${s.done ? "checked" : ""}>
      <span class="${s.done ? 'done' : ''}">${escapeHtml(s.text)}</span>
      <button class="subtask-remove" data-idx="${i}">&times;</button>
    </div>
  `).join("");

  subtaskListEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", () => {
      draftSubtasks[cb.dataset.idx].done = cb.checked;
      renderDraftSubtasks();
    });
  });
  subtaskListEl.querySelectorAll(".subtask-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      draftSubtasks.splice(btn.dataset.idx, 1);
      renderDraftSubtasks();
    });
  });
}

subtaskInputEl.addEventListener("keydown", (e) => {
  if(e.key === "Enter" && subtaskInputEl.value.trim()){
    e.preventDefault();
    draftSubtasks.push({ text: subtaskInputEl.value.trim(), done: false });
    subtaskInputEl.value = "";
    renderDraftSubtasks();
  }
});

document.getElementById("saveTaskBtn").addEventListener("click", () => {
  const title = taskTitleEl.value.trim();
  if(!title){ showToast("Please give the task a title"); taskTitleEl.focus(); return; }

  if(editingTaskId){
    const task = tasks.find(t => t.id === editingTaskId);
    Object.assign(task, {
      title, desc: taskDescEl.value.trim(),
      priority: taskPriorityEl.value,
      due: taskDueEl.value,
      category: taskCategoryEl.value.trim(),
      subtasks: draftSubtasks,
    });
    showToast("Task updated");
  }else{
    tasks.unshift({
      id: uid(), title, desc: taskDescEl.value.trim(),
      priority: taskPriorityEl.value,
      due: taskDueEl.value,
      category: taskCategoryEl.value.trim(),
      subtasks: draftSubtasks,
      status: "todo",
    });
    showToast("Task created");
  }
  closeModal();
  renderAll();
});

deleteTaskBtn.addEventListener("click", () => {
  if(!editingTaskId) return;
  tasks = tasks.filter(t => t.id !== editingTaskId);
  showToast("Task deleted");
  closeModal();
  renderAll();
});

// ===========================================================
// Init
// ===========================================================
loadTasks();
renderAll();
