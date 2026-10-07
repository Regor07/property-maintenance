const K = 'propertyMaintenance.v2';
const CALENDAR_HORIZON_MONTHS = 12;

const now = new Date();

function iso(d) {
    const x = new Date(d);

    return [
        x.getFullYear(),
        String(x.getMonth() + 1).padStart(2, '0'),
        String(x.getDate()).padStart(2, '0')
    ].join('-');
}

function parseDate(value) {
    const [y, m, d] = String(value).split('-').map(Number);
    return new Date(y, m - 1, d);
}

function today() {
    return iso(new Date());
}

function addDays(date, amount) {
    const d = parseDate(date);
    d.setDate(d.getDate() + amount);
    return iso(d);
}

function addMonths(date, amount) {
    const d = parseDate(date);
    const day = d.getDate();

    const result = new Date(
        d.getFullYear(),
        d.getMonth() + amount,
        1
    );

    const lastDay =
        new Date(
            result.getFullYear(),
            result.getMonth() + 1,
            0
        ).getDate();

    result.setDate(Math.min(day, lastDay));

    return iso(result);
}

function addYears(date, amount) {
    const d = parseDate(date);
    const month = d.getMonth();
    const day = d.getDate();

    const result = new Date(
        d.getFullYear() + amount,
        month,
        1
    );

    const lastDay =
        new Date(
            result.getFullYear(),
            month + 1,
            0
        ).getDate();

    result.setDate(Math.min(day, lastDay));

    return iso(result);
}


/* =========================
   WEEKEND DATES
========================= */

function saturday() {
    const d = new Date();
    const day = d.getDay();

    d.setDate(
        d.getDate() + (day === 0 ? -1 : 6 - day)
    );

    return iso(d);
}

const S = saturday();
const U = addDays(S, 1);


/* =========================
   DATABASE
========================= */

const defaultDB = {
    tasks: [],
    todos: [],
    shopping: [],
    categories: [
        'House',
        'Yard',
        'Vehicles',
        'Equipment',
        'Pets',
        'Other'
    ]
};

let db =
    JSON.parse(localStorage.getItem(K) || 'null') ||
    defaultDB;


/* =========================
   MIGRATION / NORMALIZATION
========================= */

function normalizeRecurrence(value) {

    const v =
        String(value || '')
            .toLowerCase()
            .trim();

    const map = {
        'none': 'none',
        'no recurrence': 'none',

        '1 day': 'daily',
        'daily': 'daily',
        'every day': 'daily',

        '1 week': 'weekly',
        '7 days': 'weekly',
        'weekly': 'weekly',
        'every week': 'weekly',

        '2 weeks': 'biweekly',
        '14 days': 'biweekly',
        'biweekly': 'biweekly',
        'every 2 weeks': 'biweekly',

        '1 month': 'monthly',
        'monthly': 'monthly',
        'every month': 'monthly',

        '3 months': '3months',
        'every 3 months': '3months',

        '6 months': '6months',
        'every 6 months': '6months',

        '1 year': 'yearly',
        '12 months': 'yearly',
        'yearly': 'yearly',
        'every year': 'yearly'
    };

    return map[v] || 'none';
}


function normalizeTask(task) {

    task.recurrence =
        normalizeRecurrence(task.recurrence);

    if (typeof task.adjustSchedule !== 'boolean') {
        task.adjustSchedule = false;
    }

    if (!('completedAt' in task)) {
        task.completedAt = null;
    }

    if (!Array.isArray(task.materials)) {
        task.materials = [];
    }

    task.materials =
        task.materials
            .map(normalizeMaterial)
            .filter(x => x.name);

    if (!task.due) {
        task.due = today();
    }

    return task;
}

function normalizeCategory(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ');
}


function categoryExists(name) {
    const normalized =
        normalizeCategory(name).toLowerCase();

    return db.categories.some(
        x =>
            normalizeCategory(x).toLowerCase() ===
            normalized
    );
}


function addCategory(name) {

    const category =
        normalizeCategory(name);

    if (!category) {
        return null;
    }

    const existing =
        db.categories.find(
            x =>
                normalizeCategory(x).toLowerCase() ===
                category.toLowerCase()
        );

    if (existing) {
        return existing;
    }

    db.categories.push(category);

    db.categories.sort(
        (a, b) =>
            a.localeCompare(b)
    );

    save();

    return category;
}


function syncCategories() {

    if (!Array.isArray(db.categories)) {
        db.categories = [];
    }

    const defaults = [
        'House',
        'Yard',
        'Vehicles',
        'Equipment',
        'Pets',
        'Other'
    ];

    const all =
        [
            ...defaults,
            ...db.categories,
            ...db.tasks.map(
                x => x.category
            )
        ]
            .map(normalizeCategory)
            .filter(Boolean);

    const unique = [];

    all.forEach(category => {

        const exists =
            unique.some(
                x =>
                    x.toLowerCase() ===
                    category.toLowerCase()
            );

        if (!exists) {
            unique.push(category);
        }
    });

    db.categories =
        unique.sort(
            (a, b) =>
                a.localeCompare(b)
        );
}

db.tasks = Array.isArray(db.tasks)
    ? db.tasks.map(normalizeTask)
    : [];

db.todos = Array.isArray(db.todos)
    ? db.todos
    : [];

db.shopping = Array.isArray(db.shopping)
    ? db.shopping
    : [];

syncCategories();
syncShop();
save();

function save() {
    localStorage.setItem(K, JSON.stringify(db));
}


function esc(x) {
    return String(x ?? '').replace(
        /[&<>"']/g,
        c => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[c])
    );
}


/* =========================
   SHOPPING
========================= */

function syncShop() {

    const grouped = {};

    function addMaterials(source, sourceType) {

        (source.materials || []).forEach(material => {

            const normalized =
                normalizeMaterial(material);

            const name =
                normalized.name;

            if (!name) {
                return;
            }

            const key =
                name.toLowerCase();

            if (!grouped[key]) {

                grouped[key] = {
                    name,
                    quantity: 0,
                    unit: normalized.unit || '',
                    tasks: [],
                    todos: [],
                    bought: false
                };
            }

            grouped[key].quantity +=
                normalized.quantity || 1;

            if (sourceType === 'task') {

                if (
                    !grouped[key].tasks.includes(
                        source.name
                    )
                ) {
                    grouped[key].tasks.push(
                        source.name
                    );
                }

            } else {

                if (
                    !grouped[key].todos.includes(
                        source.name
                    )
                ) {
                    grouped[key].todos.push(
                        source.name
                    );
                }

            }
        });
    }


    /* Maintenance materials */
    db.tasks.forEach(task => {
        addMaterials(task, 'task');
    });


    /* To-Do materials */
    db.todos.forEach(todo => {
        addMaterials(todo, 'todo');
    });


    db.shopping =
        Object.values(grouped).map(
            (item, i) => {

                const existing =
                    db.shopping.find(
                        x =>
                            String(x.name || '')
                                .toLowerCase() ===
                            item.name.toLowerCase()
                    );

                return {

                    id:
                        existing?.id ||
                        Date.now() + i,

                    name:
                        item.name,

                    quantity:
                        item.quantity,

                    unit:
                        item.unit,

                    tasks:
                        item.tasks,

                    todos:
                        item.todos,

                    bought:
                        existing?.bought || false
                };
            }
        );
}


/* =========================
   RECURRENCE
========================= */

function recurrenceLabel(value) {

    const labels = {
        none: 'No recurrence',
        daily: 'Every day',
        weekly: 'Every week',
        biweekly: 'Every 2 weeks',
        monthly: 'Every month',
        '3months': 'Every 3 months',
        '6months': 'Every 6 months',
        yearly: 'Every year'
    };

    return labels[value] || 'No recurrence';
}


function nextOccurrence(date, recurrence) {

    switch (recurrence) {

        case 'daily':
            return addDays(date, 1);

        case 'weekly':
            return addDays(date, 7);

        case 'biweekly':
            return addDays(date, 14);

        case 'monthly':
            return addMonths(date, 1);

        case '3months':
            return addMonths(date, 3);

        case '6months':
            return addMonths(date, 6);

        case 'yearly':
            return addYears(date, 1);

        default:
            return null;
    }
}


/* =========================
   WEEKEND
========================= */

function itemHTML(x) {

    const isTodo = db.todos.includes(x);

    const category = isTodo
        ? 'To-Do'
        : (x.category || 'Maintenance');

    const minutes = x.minutes || 0;

    const materials = !isTodo
        ? (x.materials || [])
            .map(materialName)
            .filter(Boolean)
        : [];

    return `
    <div class="task ${x.done ? 'done' : ''}">

      <input
        type="checkbox"
        ${x.done ? 'checked' : ''}
        onchange="toggle(${x.id})"
      >

      <div class="taskmain">

        <div class="title">
          ${esc(x.name)}
        </div>

        <div class="meta">
          ${esc(category)}
          ${minutes ? ' · ' + minutes + ' min' : ''}
          ${isTodo && x.priority
            ? ' · ' + esc(x.priority)
            : ''
        }
        </div>

        ${isTodo && x.notes
            ? `
                <div class="meta">
                    ${esc(x.notes)}
                </div>
                `
            : ''
        }

        ${materials.length
            ? `
                <div class="chips">
                  ${materials
                .map(
                    m =>
                        `<span class="chip">${esc(m)}</span>`
                )
                .join('')}
                </div>
                `
            : ''
        }

      </div>

    </div>
    `;
}


function renderWeekend() {

    const todayDate = today();

    const overdueMaintenance = db.tasks.filter(x =>
        !x.done &&
        x.due &&
        x.due < todayDate
    );

    const overdueTodos = db.todos.filter(x =>
        !x.done &&
        x.planned &&
        x.planned < todayDate
    );

    const dueTodayMaintenance = db.tasks.filter(x =>
        !x.done &&
        x.due === todayDate
    );

    const dueTodayTodos = db.todos.filter(x =>
        !x.done &&
        x.planned === todayDate
    );

    const saturdayItems = [
        ...db.tasks.filter(x =>
            !x.done &&
            x.due === S
        ),
        ...db.todos.filter(x =>
            !x.done &&
            x.planned === S
        )
    ];

    const sundayItems = [
        ...db.tasks.filter(x =>
            !x.done &&
            x.due === U
        ),
        ...db.todos.filter(x =>
            !x.done &&
            x.planned === U
        )
    ];

    const allItems = [
        ...overdueMaintenance,
        ...overdueTodos,
        ...dueTodayMaintenance,
        ...dueTodayTodos,
        ...saturdayItems,
        ...sundayItems
    ];

    const mins = allItems.reduce(
        (n, x) => n + (x.minutes || 0),
        0
    );

    document.querySelector('#weekend').innerHTML = `

    <div class="summary">

      <div class="stat">
        <b>${allItems.length}</b>
        Open this weekend
      </div>

      <div class="stat">
        <b>${(mins / 60).toFixed(1)}h</b>
        Estimated work
      </div>

      <div class="stat">
        <b>
          ${db.shopping.filter(x => !x.bought).length}
        </b>
        Items to buy
      </div>

    </div>


    ${overdueMaintenance.length ||
            overdueTodos.length
            ? `
        <div class="card">

          <h2>
            Overdue
            <span class="muted">Needs attention</span>
          </h2>

          ${[
                ...overdueMaintenance,
                ...overdueTodos
            ]
                .map(itemHTML)
                .join('')
            }

        </div>
        `
            : ''
        }


    ${dueTodayMaintenance.length ||
            dueTodayTodos.length
            ? `
        <div class="card">

          <h2>
            Due Today
            <span class="muted">${todayDate}</span>
          </h2>

          ${[
                ...dueTodayMaintenance,
                ...dueTodayTodos
            ]
                .map(itemHTML)
                .join('')
            }

        </div>
        `
            : ''
        }


    <div class="grid">

      <div class="card">

        <h2>
          Saturday
          <span class="muted">${S}</span>
        </h2>

        ${saturdayItems
            .map(itemHTML)
            .join('') ||
        '<div class="empty">Nothing planned.</div>'
        }

      </div>


      <div class="card">

        <h2>
          Sunday
          <span class="muted">${U}</span>
        </h2>

        ${sundayItems
            .map(itemHTML)
            .join('') ||
        '<div class="empty">Nothing planned.</div>'
        }

      </div>

    </div>
    `;
}


/* =========================
   MAINTENANCE
========================= */

function renderMaintenance() {

    document.querySelector('#maintenance').innerHTML = `

    <div class="card">

      <div
        style="
          display:flex;
          justify-content:space-between;
          align-items:center;
          gap:10px;
          flex-wrap:wrap
        "
      >

        <div>
          <h2>Recurring maintenance</h2>

          <p class="muted">
            Things that come back automatically.
          </p>
        </div>

        <button
          class="primary"
          type="button"
          onclick="openMaintenanceForm()"
        >
          ＋ Add Maintenance
        </button>

      </div>

      ${db.tasks.map(t => `

          <div class="task">

            <div class="taskmain">

              <div class="title">
                ${esc(t.name)}
              </div>

              <div class="meta">

                ${esc(t.category || 'House')}

                · ${recurrenceLabel(t.recurrence)}

                · Next ${esc(t.due)}

                · ${t.minutes || 0} min

              </div>

              ${t.recurrence !== 'none'
            ? `
                    <div class="meta">
                      ${t.adjustSchedule
                ? 'Schedule: Based on actual completion'
                : 'Schedule: Based on scheduled date'
            }
                    </div>
                    `
            : ''
        }

              ${t.completedAt
            ? `
                    <div class="meta">
                      Last completed ${esc(t.completedAt)}
                    </div>
                    `
            : ''
        }

                ${t.materials?.length
            ? `
                <div class="chips">
                ${t.materials
                .map(m => {

                    const name =
                        typeof m === 'object'
                            ? m.name
                            : m;

                    return `
                            <span class="chip">
                                ${esc(name)}
                            </span>
                        `;
                })
                .join('')}
                </div>
                `
            : ''
        }

            </div>

            <div class="actions">

              <button
                class="small"
                type="button"
                onclick="editTask(${t.id})"
              >
                Edit
              </button>

              <button
                class="small"
                type="button"
                onclick="delTask(${t.id})"
              >
                Delete
              </button>

            </div>

          </div>

        `).join('') ||
        '<div class="empty">No maintenance items yet.</div>'
        }

    </div>
    `;
}


/* =========================
   TO-DO
========================= */

function renderTodo() {

    const p = {
        important: 0,
        normal: 1,
        whenever: 2
    };

    const a =
        [...db.todos].sort(
            (x, y) =>
                p[x.priority] -
                p[y.priority]
        );

    document.querySelector('#todo').innerHTML = `

    <div class="card">

      <div
        style="
          display:flex;
          justify-content:space-between;
          align-items:center;
          gap:10px;
          flex-wrap:wrap
        "
      >

        <div>

          <h2>To-Do</h2>

          <p class="muted">
            One-off things that need to be done
            but don't need a recurring schedule.
          </p>

        </div>

        <button
          class="primary"
          type="button"
          onclick="openTodoForm()"
        >
          ＋ Add To-Do
        </button>

      </div>

      ${a.map(t => `

          <div class="task ${t.done ? 'done' : ''}">

            <input
              type="checkbox"
              ${t.done ? 'checked' : ''}
              onchange="toggle(${t.id})"
            >

            <div class="taskmain">

              <div class="title">
                ${esc(t.name)}
              </div>

              <div class="meta">

                ${esc(t.priority)}

                ${t.planned
            ? ' · Planned ' +
            esc(t.planned)
            : ''
        }

                ${t.notes
            ? ' · ' +
            esc(t.notes)
            : ''
        }

              </div>

            </div>

            <div class="actions">

              <button
                class="small"
                type="button"
                onclick="editTodo(${t.id})"
              >
                Edit
              </button>

              <button
                class="small"
                type="button"
                onclick="delTodo(${t.id})"
              >
                Delete
              </button>

            </div>

          </div>

        `).join('') ||
        '<div class="empty">No To-Dos yet.</div>'
        }

    </div>
    `;
}


/* =========================
   SHOPPING
========================= */

function renderShopping() {

    document.querySelector(
        '#shopping'
    ).innerHTML = `

        <div class="card">

            <h2>Shopping</h2>

            <p class="muted">
                Materials needed for maintenance and To-Dos.
            </p>

            ${db.shopping
            .map(item => `

                    <div
                        class="shopping-item ${item.bought ? 'done' : ''}"
                    >

                        <div class="shopping-check">

                            <input
                                type="checkbox"
                                ${item.bought ? 'checked' : ''}
                                onchange="shop(${item.id})"
                            >

                        </div>

                        <div class="taskmain">

                            <div class="title">
                                ${esc(item.name)}
                            </div>

                            <div class="meta">
                                ${item.quantity || 1}
                                ${item.unit
                    ? ' ' + esc(item.unit)
                    : ''
                }
                            </div>

                            ${item.tasks?.length
                    ? `
                                    <div class="meta">
                                        Maintenance:
                                        ${esc(item.tasks.join(', '))}
                                    </div>
                                  `
                    : ''
                }

                            ${item.todos?.length
                    ? `
                                    <div class="meta">
                                        To-Do:
                                        ${esc(item.todos.join(', '))}
                                    </div>
                                  `
                    : ''
                }

                            <div class="actions">

                                <button
                                    class="small"
                                    type="button"
                                    onclick="findPrices('${esc(
                    item.name
                ).replace(/'/g, "\\'")}')"
                                >
                                    Find prices
                                </button>

                            </div>

                        </div>

                    </div>

                `)
            .join('')

        ||

        '<div class="empty">Nothing to buy.</div>'
        }

        </div>
    `;
}

function findPrices(name) {

    const query =
        encodeURIComponent(
            name + ' price'
        );

    window.open(
        'https://www.google.com/search?q=' +
        query,
        '_blank',
        'noopener'
    );
}


/* =========================
   CALENDAR
========================= */

let calendarYear = now.getFullYear();
let calendarMonth = now.getMonth();


function changeMonth(amount) {

    calendarMonth += amount;

    if (calendarMonth > 11) {
        calendarMonth = 0;
        calendarYear++;
    }

    if (calendarMonth < 0) {
        calendarMonth = 11;
        calendarYear--;
    }

    renderCalendar();
}


function goToday() {

    calendarYear = now.getFullYear();
    calendarMonth = now.getMonth();

    renderCalendar();
}


function isWithinCalendarHorizon(date) {

    const start =
        parseDate(
            addMonths(
                today(),
                -CALENDAR_HORIZON_MONTHS
            )
        );

    const end =
        parseDate(
            addMonths(
                today(),
                CALENDAR_HORIZON_MONTHS
            )
        );

    const d =
        parseDate(date);

    return d >= start && d <= end;
}

function materialName(material) {
    if (typeof material === 'string') {
        return material.trim();
    }

    if (material && typeof material === 'object') {
        return String(
            material.name ||
            material.item ||
            material.material ||
            ''
        ).trim();
    }

    return '';
}

function recurrenceMatchesDate(task, date) {

    if (task.recurrence === 'none') {
        return task.due === date;
    }

    const target =
        parseDate(date);

    const start =
        parseDate(task.due);

    if (target < start) {
        return false;
    }

    if (!isWithinCalendarHorizon(date)) {
        return false;
    }

    switch (task.recurrence) {

        case 'daily':
            return true;

        case 'weekly': {
            const diff =
                Math.round(
                    (
                        target - start
                    ) /
                    86400000
                );

            return diff % 7 === 0;
        }

        case 'biweekly': {
            const diff =
                Math.round(
                    (
                        target - start
                    ) /
                    86400000
                );

            return diff % 14 === 0;
        }

        case 'monthly':
        case '3months':
        case '6months':
        case 'yearly': {

            let cursor =
                task.due;

            while (cursor < date) {

                const next =
                    nextOccurrence(
                        cursor,
                        task.recurrence
                    );

                if (!next || next > date) {
                    return false;
                }

                cursor = next;
            }

            return cursor === date;
        }

        default:
            return false;
    }
}

function calendarEventHTML(item, type, date) {

    const isTask =
        type === 'task';

    const completed =
        isTask
            ? false
            : !!item.done;

    const categoryClass =
        isTask
            ? 'calendar-maintenance'
            : 'calendar-todo';

    return `

    <div
        class="calendar-event ${categoryClass}"
        draggable="true"
        data-id="${item.id}"
        data-type="${type}"
        data-date="${date}"
        ondragstart="calendarDragStart(event)"
        onclick="calendarEventClick(event, '${type}', ${item.id})"
    >

        <label
            class="calendar-check"
            onclick="event.stopPropagation()"
        >

            <input
                type="checkbox"
                ${completed ? 'checked' : ''}
                onchange="calendarComplete(event, '${type}', ${item.id}, '${date}')"
            >

        </label>

        <span class="calendar-event-name">
            ${esc(item.name)}
        </span>

    </div>

    `;
}

function calendarComplete(event, type, id, calendarDate) {

    event.stopPropagation();

    /*
     * =========================
     * MAINTENANCE
     * =========================
     */

    if (type === 'task') {

        const task =
            db.tasks.find(
                x => x.id === id
            );

        if (!task) {
            return;
        }

        /*
         * For a calendar completion,
         * the completion date is the
         * calendar occurrence that was checked.
         */
        toggle(
            id,
            calendarDate
        );

        return;
    }


    /*
     * =========================
     * TO-DO
     * =========================
     */

    if (type === 'todo') {

        const todo =
            db.todos.find(
                x => x.id === id
            );

        if (!todo) {
            return;
        }

        todo.done =
            event.target.checked;

        save();
        render();
    }
}


let calendarDragData = null;

document.addEventListener(
    'dragend',
    function () {

        calendarDragData = null;

        document
            .querySelectorAll(
                '.calendar-dragging'
            )
            .forEach(
                x =>
                    x.classList.remove(
                        'calendar-dragging'
                    )
            );

        document
            .querySelectorAll(
                '.calendar-drop-target'
            )
            .forEach(
                x =>
                    x.classList.remove(
                        'calendar-drop-target'
                    )
            );
    }
);

function renderCalendar() {

    const y = calendarYear;
    const m = calendarMonth;

    const first =
        new Date(y, m, 1);

    const days =
        new Date(y, m + 1, 0).getDate();

    const off =
        first.getDay();

    const title =
        first.toLocaleDateString(
            undefined,
            {
                month: 'long',
                year: 'numeric'
            }
        );

    let h = `

    <div class="card">

      <div
        style="
          display:flex;
          justify-content:space-between;
          align-items:center;
          gap:10px;
          flex-wrap:wrap;
          margin-bottom:10px
        "
      >

        <h2 style="margin:0">
          ${title}
        </h2>

        <div style="display:flex;gap:5px">

          <button
            class="small"
            type="button"
            onclick="changeMonth(-1)"
          >
            ←
          </button>

          <button
            class="small"
            type="button"
            onclick="goToday()"
          >
            Today
          </button>

          <button
            class="small"
            type="button"
            onclick="changeMonth(1)"
          >
            →
          </button>

        </div>

      </div>

      <div class="calendar">

        ${[
            'Sun',
            'Mon',
            'Tue',
            'Wed',
            'Thu',
            'Fri',
            'Sat'
        ]
            .map(
                x =>
                    `<div class="dow">${x}</div>`
            )
            .join('')}

    `;

    for (let i = 0; i < off; i++) {
        h += '<div class="day"></div>';
    }

    for (let d = 1; d <= days; d++) {

        const q =
            iso(new Date(y, m, d));

        const maintenanceEvents =
            db.tasks.filter(
                task =>
                    recurrenceMatchesDate(
                        task,
                        q
                    )
            );

        const todoEvents =
            db.todos.filter(
                task =>
                    task.planned === q
            );

        h += `

        <div
            class="day"
            data-date="${q}"
            ondragover="calendarDragOver(event)"
            ondrop="calendarDrop(event, '${q}')"
        >

          <b>${d}</b>

          <div class="calendar-events">

            ${maintenanceEvents
                .map(task =>
                    calendarEventHTML(
                        task,
                        'task',
                        q
                    )
                )
                .join('')}

            ${todoEvents
                .map(todo =>
                    calendarEventHTML(
                        todo,
                        'todo',
                        q
                    )
                )
                .join('')}

          </div>

        </div>
        `;
    }

    h += `

      </div>

      <p
        class="muted"
        style="font-size:.78rem;margin-bottom:0"
      >
        Drag an item to reschedule it. Check the box
        when it is actually completed. Click the name
        to edit it.
      </p>

    </div>
    `;

    document.querySelector(
        '#calendar'
    ).innerHTML = h;
}

/* =========================
   CALENDAR DRAG & DROP
========================= */

let draggedCalendarItem = null;

function calendarEventClick(event) {

    /*
     * Prevent the click from being treated
     * as a drag/drop interaction.
     */
    event.stopPropagation();

    const element =
        event.currentTarget;

    const id =
        Number(element.dataset.id);

    const type =
        element.dataset.type;


    if (!id) {
        return;
    }


    if (type === 'todo') {

        const todo =
            db.todos.find(
                x => x.id === id
            );

        if (todo) {
            openTodoForm(todo);
        }

        return;
    }


    if (type === 'task') {

        const task =
            db.tasks.find(
                x => x.id === id
            );

        if (task) {
            openMaintenanceForm(task);
        }

        return;
    }
}

function calendarDragStart(event) {

    const element =
        event.currentTarget;

    draggedCalendarItem = {
        id: Number(element.dataset.id),
        type: element.dataset.type
    };

    event.dataTransfer.effectAllowed = 'move';

    event.dataTransfer.setData(
        'text/plain',
        JSON.stringify(draggedCalendarItem)
    );
}


function calendarDragOver(event) {

    event.preventDefault();

    event.dataTransfer.dropEffect = 'move';

    const day =
        event.currentTarget;

    day.classList.add('calendar-drop-target');
}


function calendarDrop(event) {

    event.preventDefault();

    const day =
        event.currentTarget;

    day.classList.remove(
        'calendar-drop-target'
    );

    const date =
        day.dataset.date;

    if (!date) {
        return;
    }

    if (!draggedCalendarItem) {
        return;
    }

    const item =
        draggedCalendarItem;

    draggedCalendarItem = null;


    /* =========================
       TO-DO
    ========================= */

    if (item.type === 'todo') {

        const todo =
            db.todos.find(
                x => x.id === item.id
            );

        if (!todo) {
            return;
        }

        todo.planned = date;

        save();
        render();

        return;
    }


    /* =========================
       MAINTENANCE
    ========================= */

    const task =
        db.tasks.find(
            x => x.id === item.id
        );

    if (!task) {
        return;
    }


    /*
     * Non-recurring maintenance can
     * simply be moved.
     */

    if (task.recurrence === 'none') {

        task.due = date;

        save();
        render();

        return;
    }


    /*
     * If dropped on its existing date,
     * nothing needs to happen.
     */

    if (task.due === date) {
        return;
    }


    /*
     * IMPORTANT:
     *
     * Do not open confirm() directly inside
     * the browser's drop event.
     *
     * Defer it until the drop event has
     * completely finished.
     */

    const recurrence =
        recurrenceLabel(
            task.recurrence
        );


    setTimeout(() => {

        const confirmed =
            confirm(
                `"${task.name}" is a recurring maintenance item.\n\n` +
                `Moving it to ${date} will change the schedule anchor.\n` +
                `Future occurrences will continue from the new date ` +
                `using ${recurrence.toLowerCase()}.\n\n` +
                `Do you want to move the entire schedule?`
            );


        if (!confirmed) {

            renderCalendar();

            return;
        }


        /*
         * User confirmed the move.
         */

        task.due = date;

        save();

        render();

    }, 0);
}


/* =========================
   CHECKBOXES
========================= */

function toggle(id, completedDate = today()) {

    const task =
        db.tasks.find(
            x => x.id === id
        );

    if (task) {

        /*
         * =========================
         * RECURRING MAINTENANCE
         * =========================
         */

        if (task.recurrence !== 'none') {

            const completed =
                completedDate || today();

            task.completedAt =
                completed;


            /*
             * YES:
             * Future schedule is based
             * on the actual completion date.
             *
             * Example:
             * Due June 1
             * Completed June 2
             * Every 2 weeks
             * Next due June 16
             */

            if (task.adjustSchedule) {

                task.due =
                    nextOccurrence(
                        completed,
                        task.recurrence
                    );

            }


            /*
             * NO:
             * Keep the original schedule
             * anchored to its existing dates.
             *
             * If the task was completed late,
             * skip any occurrences that
             * have already passed.
             */

            else {

                let next =
                    nextOccurrence(
                        task.due,
                        task.recurrence
                    );

                while (
                    next &&
                    next <= completed
                ) {

                    next =
                        nextOccurrence(
                            next,
                            task.recurrence
                        );
                }

                task.due =
                    next || completed;
            }


            save();
            render();

            return;
        }


        /*
         * =========================
         * NON-RECURRING MAINTENANCE
         * =========================
         */

        task.done =
            !task.done;

        task.completedAt =
            task.done
                ? today()
                : null;

        save();
        render();

        return;
    }


    /*
     * =========================
     * TO-DO
     * =========================
     */

    const todo =
        db.todos.find(
            x => x.id === id
        );

    if (todo) {

        todo.done =
            !todo.done;

        save();
        render();
    }
}

function shop(id) {

    const x =
        db.shopping.find(
            x => x.id === id
        );

    if (!x) return;

    x.bought =
        !x.bought;

    save();
    render();
}

function normalizeMaterial(material) {

    if (typeof material === 'string') {

        return {
            name: material,
            quantity: 1,
            unit: ''
        };
    }

    return {

        name:
            String(
                material?.name || ''
            ).trim(),

        quantity:
            Number(
                material?.quantity
            ) || 1,

        unit:
            String(
                material?.unit || ''
            ).trim()
    };
}


function materialRows(materials = []) {

    const normalized =
        materials.length
            ? materials.map(normalizeMaterial)
            : [
                {
                    name: '',
                    quantity: 1,
                    unit: ''
                }
            ];

    return normalized
        .map(material => `

            <div class="material-row">

                <input
                    class="material-name"
                    type="text"
                    placeholder="Material name"
                    value="${esc(material.name)}"
                >

                <input
                    class="material-quantity"
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Qty"
                    value="${material.quantity}"
                >

                <input
                    class="material-unit"
                    type="text"
                    placeholder="Unit"
                    value="${esc(material.unit)}"
                >

                <button
                    type="button"
                    class="small material-remove"
                    onclick="removeMaterial(this)"
                >
                    ×
                </button>

            </div>

        `)
        .join('');
}


function addMaterial() {

    const list =
        document.querySelector(
            '#materialsList'
        );

    if (!list) {
        return;
    }

    list.insertAdjacentHTML(
        'beforeend',
        materialRows([])
    );
}


function removeMaterial(button) {

    const row =
        button.closest(
            '.material-row'
        );

    if (row) {
        row.remove();
    }
}

function addTodoMaterial() {

    const list =
        document.querySelector(
            '#todoMaterialsList'
        );

    if (!list) {
        return;
    }

    list.insertAdjacentHTML(
        'beforeend',
        materialRows([])
    );
}


function getMaterialsFromForm() {

    const rows =
        document.querySelectorAll(
            '.material-row'
        );

    return [...rows]
        .map(row => {

            const name =
                row.querySelector(
                    '.material-name'
                ).value.trim();

            const quantity =
                Number(
                    row.querySelector(
                        '.material-quantity'
                    ).value
                ) || 1;

            const unit =
                row.querySelector(
                    '.material-unit'
                ).value.trim();

            return {
                name,
                quantity,
                unit
            };

        })
        .filter(
            material =>
                material.name
        );
}


/* =========================
   FORMS
========================= */

function openMaintenanceForm(obj = null) {
    showForm('task', obj);
}


function openTodoForm(obj = null) {
    showForm('todo', obj);
}

function categoryDropdown(selected = '') {

    const value =
        normalizeCategory(selected);

    return `

    <select
        name="category"
        id="categorySelect"
        onchange="categoryChanged()"
    >

        <option
            value=""
            ${!value ? 'selected' : ''}
        >
            Select a category
        </option>

        ${db.categories
            .map(
                category => `
                <option
                    value="${esc(category)}"
                    ${category.toLowerCase() ===
                        value.toLowerCase()
                        ? 'selected'
                        : ''
                    }
                >
                    ${esc(category)}
                </option>
                `
            )
            .join('')}

        <option value="__add__">
            ＋ Add category...
        </option>

    </select>

    <div
        id="newCategoryArea"
        class="new-category-area"
    ></div>

    `;
}


function categoryChanged() {

    const select =
        document.querySelector(
            '#categorySelect'
        );

    const area =
        document.querySelector(
            '#newCategoryArea'
        );

    if (!select || !area) {
        return;
    }

    if (select.value === '__add__') {

        area.innerHTML = `

        <div class="new-category-row">

            <input
                type="text"
                id="newCategoryInput"
                maxlength="40"
                placeholder="New category"
                autocomplete="off"
            >

            <button
                type="button"
                class="small"
                onclick="addNewCategory()"
            >
                Add
            </button>

        </div>

        `;

        document
            .querySelector('#newCategoryInput')
            ?.focus();

    } else {

        area.innerHTML = '';
    }
}


function addNewCategory() {

    const input =
        document.querySelector(
            '#newCategoryInput'
        );

    const select =
        document.querySelector(
            '#categorySelect'
        );

    if (!input || !select) {
        return;
    }

    const category =
        addCategory(input.value);

    if (!category) {
        input.focus();
        return;
    }

    select.innerHTML = `

        <option value="">
            Select a category
        </option>

        ${db.categories
            .map(
                x => `
                <option
                    value="${esc(x)}"
                >
                    ${esc(x)}
                </option>
                `
            )
            .join('')}

        <option value="__add__">
            ＋ Add category...
        </option>

    `;

    select.value = category;

    const area =
        document.querySelector(
            '#newCategoryArea'
        );

    if (area) {
        area.innerHTML = '';
    }
}


function createCategoryFromInput() {

    const input =
        document.querySelector(
            '#categoryInput'
        );

    if (!input) {
        return;
    }

    const category =
        addCategory(
            input.value
        );

    if (!category) {
        return;
    }

    input.value =
        category;

    hideCategoryOptions();
}


function hideCategoryOptions() {

    const options =
        document.querySelector(
            '#categoryOptions'
        );

    if (options) {
        options.classList.remove('open');
    }
}


document.addEventListener(
    'click',
    function (e) {

        if (
            !e.target.closest(
                '.category-combobox'
            )
        ) {
            hideCategoryOptions();
        }
    }
);


function showForm(type, obj = null) {

    const modal =
        document.querySelector('#modal');

    const form =
        document.querySelector('#form');

    const title =
        document.querySelector('#modalTitle');

    const body =
        document.querySelector('#formBody');


    title.textContent =
        obj
            ? 'Edit item'
            : type === 'task'
                ? 'Add Maintenance'
                : 'Add To-Do';


    if (type === 'task') {

        body.innerHTML = `

        <div class="field">

          <label>Name</label>

          <input
            name="name"
            required
            value="${esc(obj?.name || '')}"
          >

        </div>


        <div class="field">

            <label>Category</label>

            ${categoryDropdown(
            obj?.category || ''
        )}

        </div>


        <div class="field">

          <label>Recurrence</label>

          <select name="recurrence">

            <option
              value="none"
              ${!obj ||
                obj.recurrence === 'none'
                ? 'selected'
                : ''}
            >
              No recurrence
            </option>

            <option
              value="daily"
              ${obj?.recurrence === 'daily'
                ? 'selected'
                : ''}
            >
              Every day
            </option>

            <option
              value="weekly"
              ${obj?.recurrence === 'weekly'
                ? 'selected'
                : ''}
            >
              Every week
            </option>

            <option
              value="biweekly"
              ${obj?.recurrence === 'biweekly'
                ? 'selected'
                : ''}
            >
              Every 2 weeks
            </option>

            <option
              value="monthly"
              ${obj?.recurrence === 'monthly'
                ? 'selected'
                : ''}
            >
              Every month
            </option>

            <option
              value="3months"
              ${obj?.recurrence === '3months'
                ? 'selected'
                : ''}
            >
              Every 3 months
            </option>

            <option
              value="6months"
              ${obj?.recurrence === '6months'
                ? 'selected'
                : ''}
            >
              Every 6 months
            </option>

            <option
              value="yearly"
              ${obj?.recurrence === 'yearly'
                ? 'selected'
                : ''}
            >
              Every year
            </option>

          </select>

        </div>


        <div class="field">

          <label>Next due</label>

          <input
            type="date"
            name="due"
            value="${esc(
                    obj?.due || today()
                )}"
          >

        </div>


        <div class="field">

          <label>Estimated minutes</label>

          <input
            type="number"
            name="minutes"
            min="0"
            value="${obj?.minutes || 30}"
          >

        </div>


        <div class="field">

  <label class="question-label">

    Should future dates be based on actual completion?

    <span
      class="tooltip"
      title="If Yes, completing the task early or late shifts the future schedule. If No, the schedule stays anchored to the original due date."
      aria-label="Schedule information"
    >
      ⓘ
    </span>

  </label>

  <div class="yes-no-group">

    <label class="yes-no-option">

      <input
        type="radio"
        name="scheduleBasis"
        value="scheduled"
        ${!obj ||
                !obj.adjustSchedule
                ? 'checked'
                : ''
            }
      >

      <span>No</span>

    </label>

    <label class="yes-no-option">

      <input
        type="radio"
        name="scheduleBasis"
        value="completion"
        ${obj?.adjustSchedule
                ? 'checked'
                : ''
            }
      >

      <span>Yes</span>

    </label>

  </div>

</div>


        <div class="field">

    <label>
        Materials needed
    </label>

    <div
        id="materialsList"
        class="materials-list"
    >
        ${materialRows(
                obj?.materials || []
            )}
    </div>

    <button
        type="button"
        class="small add-material"
        onclick="addMaterial()"
    >
        ＋ Add material
    </button>

</div>

        `;

    } else {

        body.innerHTML = `

        <div class="field">

          <label>What needs to be done?</label>

          <input
            name="name"
            required
            value="${esc(obj?.name || '')}"
          >

        </div>


        <div class="field">

          <label>Priority</label>

          <select name="priority">

            <option
              value="important"
              ${obj?.priority === 'important'
                ? 'selected'
                : ''
            }
            >
              Important
            </option>

            <option
              value="normal"
              ${!obj ||
                obj.priority === 'normal'
                ? 'selected'
                : ''
            }
            >
              Normal
            </option>

            <option
              value="whenever"
              ${obj?.priority === 'whenever'
                ? 'selected'
                : ''
            }
            >
              Whenever
            </option>

          </select>

        </div>


        <div class="field">

          <label>
            Date (optional)
          </label>

          <input
            type="date"
            name="planned"
            value="${esc(
                obj?.planned || ''
            )}"
          >

        </div>


        <div class="field">

          <label>Notes</label>

          <textarea name="notes">${esc(
                obj?.notes || ''
            )}</textarea>

        </div>

        <div class="field">

            <label>
                Materials needed, one per line
            </label>

            <textarea
                name="materials"
                placeholder="One item per line"
            >${esc(
                (obj?.materials || []).join('\n')
            )}</textarea>

            <div class="muted" style="font-size:.78rem;margin-top:5px">
                These items will appear on the Shopping list.
            </div>

        </div>

        `;
    }


    form.dataset.type =
        type;

    form.dataset.id =
        obj?.id || '';

    modal.showModal();
}


/* =========================
   FORM SUBMIT
========================= */

document
    .querySelector('#form')
    .addEventListener(
        'submit',
        function (e) {

            e.preventDefault();

            const form =
                e.currentTarget;

            const data =
                new FormData(form);

            const type =
                form.dataset.type;

            const id =
                Number(
                    form.dataset.id || 0
                );


            if (!type) {
                console.error(
                    'No form type specified.'
                );
                return;
            }


            if (type === 'task') {

                const existing =
                    db.tasks.find(
                        x => x.id === id
                    );

                const recurrence =
                    normalizeRecurrence(
                        data.get('recurrence')
                    );

                const task = {

                    id:
                        id ||
                        Date.now(),

                    name:
                        String(
                            data.get('name') || ''
                        ).trim(),

                    category:
                        addCategory(
                            data.get('category') || ''
                        ),

                    recurrence,

                    due:
                        data.get('due') ||
                        today(),

                    minutes:
                        Number(
                            data.get('minutes')
                        ) || 0,

                    materials:
                        getMaterialsFromForm(),

                    adjustSchedule:
                        data.get(
                            'scheduleBasis'
                        ) === 'completion',

                    completedAt:
                        existing?.completedAt ||
                        null,

                    done:
                        existing?.done ||
                        false
                };


                if (!task.name) {

                    alert(
                        'Please enter a maintenance name.'
                    );

                    return;
                }


                if (existing) {

                    Object.assign(
                        existing,
                        task
                    );

                } else {

                    db.tasks.push(task);
                }

                syncShop();

            } else {

                const existing =
                    db.todos.find(
                        x => x.id === id
                    );

                const todo = {

                    id:
                        id ||
                        Date.now(),

                    name:
                        String(
                            data.get('name') || ''
                        ).trim(),

                    priority:
                        data.get('priority') ||
                        'normal',

                    planned:
                        data.get('planned') ||
                        null,

                    notes:
                        String(
                            data.get('notes') || ''
                        ).trim(),

                    materials:
                        String(
                            data.get('materials') || ''
                        )
                            .split('\n')
                            .map(
                                x => x.trim()
                            )
                            .filter(Boolean),

                    done:
                        existing?.done ||
                        false
                };


                if (!todo.name) {

                    alert(
                        'Please enter something to do.'
                    );

                    return;
                }


                if (existing) {

                    Object.assign(
                        existing,
                        todo
                    );

                } else {

                    db.todos.push(todo);
                }
            }


            save();

            document
                .querySelector('#modal')
                .close();

            render();
        }
    );


/* =========================
   MODAL BUTTONS
========================= */

document
    .querySelector('#closeModal')
    .addEventListener(
        'click',
        () =>
            document
                .querySelector('#modal')
                .close()
    );


document
    .querySelector('#cancelModal')
    .addEventListener(
        'click',
        () =>
            document
                .querySelector('#modal')
                .close()
    );


/* =========================
   EDIT / DELETE
========================= */

function editTask(id) {

    const task =
        db.tasks.find(
            x => x.id === id
        );

    if (task) {
        openMaintenanceForm(task);
    }
}


function editTodo(id) {

    const todo =
        db.todos.find(
            x => x.id === id
        );

    if (todo) {
        openTodoForm(todo);
    }
}


function delTask(id) {

    if (
        confirm(
            'Delete this maintenance task?'
        )
    ) {

        db.tasks =
            db.tasks.filter(
                x => x.id !== id
            );

        syncShop();
        save();
        render();
    }
}


function delTodo(id) {

    if (
        confirm(
            'Delete this To-Do?'
        )
    ) {

        db.todos =
            db.todos.filter(
                x => x.id !== id
            );

        save();
        render();
    }
}

/* =========================
   TABS
========================= */

document
    .querySelectorAll('.tab')
    .forEach(button => {

        button.addEventListener(
            'click',
            () => {

                document
                    .querySelectorAll('.tab')
                    .forEach(
                        x =>
                            x.classList.remove(
                                'active'
                            )
                    );

                document
                    .querySelectorAll('.view')
                    .forEach(
                        x =>
                            x.classList.remove(
                                'active'
                            )
                    );

                button.classList.add(
                    'active'
                );

                document
                    .querySelector(
                        '#' +
                        button.dataset.tab
                    )
                    .classList.add(
                        'active'
                    );
            }
        );
    });


/* =========================
   RENDER
========================= */

function render() {

    renderWeekend();
    renderCalendar();
    renderMaintenance();
    renderTodo();
    renderShopping();

}


render();