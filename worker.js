const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization'
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: JSON_HEADERS });

    const url = new URL(request.url);

    try {
      if (!url.pathname.startsWith('/api/')) {
        return new Response('Not found', { status: 404 });
      }

      if (!env.DB) throw new Error('D1 binding DB is missing. Check wrangler.toml.');

      if (url.pathname === '/api/tasks' && request.method === 'GET') return json(await getTasks(env));
      if (url.pathname === '/api/tasks' && request.method === 'POST') return json(await addTask(request, env));
      if (url.pathname === '/api/stats' && request.method === 'GET') return json(await getDashboardStats(env));
      if (url.pathname === '/api/reminders/run' && request.method === 'POST') return json(await checkTaskReminders(env));
      if (url.pathname === '/api/admin/reset-email-flags' && request.method === 'POST') return json(await resetEmailFlags(env));

      const taskMatch = url.pathname.match(/^\/api\/tasks\/(\d+)$/);
      if (taskMatch && request.method === 'PUT') return json(await updateTask(Number(taskMatch[1]), request, env));
      if (taskMatch && request.method === 'DELETE') return json(await deleteTask(Number(taskMatch[1]), env));

      const completeMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/complete$/);
      if (completeMatch && request.method === 'POST') return json(await toggleTaskComplete(Number(completeMatch[1]), request, env));

      const testEmailMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/test-email$/);
      if (testEmailMatch && request.method === 'POST') return json(await sendTestEmail(Number(testEmailMatch[1]), env));

      return json({ error: 'Route not found.' }, 404);
    } catch (error) {
      return json({ error: error.message || 'Unexpected server error.' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkTaskReminders(env));
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function isValidISODate(value) {
  return !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeTaskPayload(payload) {
  const task = String(payload.task || '').trim();
  const email = String(payload.email || '').trim();
  const notes = String(payload.notes || '').trim();
  const startDate = payload.startDate || payload.start_date || '';
  const dueDate = payload.dueDate || payload.due_date || '';

  if (!task) throw new Error('Task is required.');
  if (!email) throw new Error('Email is required.');
  if (!isValidISODate(startDate)) throw new Error('Start Date must be YYYY-MM-DD.');
  if (!isValidISODate(dueDate)) throw new Error('Due Date must be YYYY-MM-DD.');
  if (startDate && dueDate && startDate > dueDate) throw new Error('Start Date cannot be after Due Date.');

  return { task, email, notes, startDate, dueDate };
}

function rowToTask(row) {
  const t = todayISO();
  let status = 'normal';

  if (Boolean(row.completed)) status = 'completed';
  else if (row.due_date && row.due_date < t) status = 'overdue';
  else if (row.start_date && row.start_date === t) status = 'startingToday';

  return {
    id: row.id,
    rowNumber: row.id,
    task: row.task || '',
    startDate: row.start_date || '',
    dueDate: row.due_date || '',
    email: row.email || '',
    completed: Boolean(row.completed),
    startEmailSent: Boolean(row.start_email_sent),
    dueEmailSent: Boolean(row.due_email_sent),
    overdueEmailSent: Boolean(row.overdue_email_sent),
    notes: row.notes || '',
    status
  };
}

async function getTasks(env) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM tasks
     ORDER BY completed ASC,
       CASE WHEN due_date IS NULL OR due_date = '' THEN 1 ELSE 0 END,
       due_date ASC,
       id ASC`
  ).all();

  return (results || []).map(rowToTask);
}

async function addTask(request, env) {
  const payload = normalizeTaskPayload(await request.json());

  const result = await env.DB.prepare(
    `INSERT INTO tasks (task, start_date, due_date, email, completed, start_email_sent, due_email_sent, overdue_email_sent, notes, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, datetime('now'))`
  ).bind(payload.task, payload.startDate, payload.dueDate, payload.email, payload.notes).run();

  return { success: true, id: result.meta.last_row_id, message: 'Task added successfully.' };
}

async function updateTask(id, request, env) {
  if (!id) throw new Error('Invalid task id.');
  const payload = normalizeTaskPayload(await request.json());

  await assertTaskExists(id, env);

  await env.DB.prepare(
    `UPDATE tasks
     SET task = ?, start_date = ?, due_date = ?, email = ?, notes = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).bind(payload.task, payload.startDate, payload.dueDate, payload.email, payload.notes, id).run();

  return { success: true, message: 'Task updated successfully.' };
}

async function deleteTask(id, env) {
  if (!id) throw new Error('Invalid task id.');
  await assertTaskExists(id, env);
  await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
  return { success: true, message: 'Task deleted successfully.' };
}

async function toggleTaskComplete(id, request, env) {
  if (!id) throw new Error('Invalid task id.');
  const body = await request.json();
  const completed = body.completed ? 1 : 0;

  await assertTaskExists(id, env);

  await env.DB.prepare(
    `UPDATE tasks SET completed = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(completed, id).run();

  return { success: true, message: completed ? 'Task marked complete.' : 'Task marked incomplete.' };
}

async function getDashboardStats(env) {
  const tasks = await getTasks(env);
  const t = todayISO();

  return tasks.reduce((stats, task) => {
    stats.total++;
    if (task.completed) stats.completed++;
    if (!task.completed && task.dueDate && task.dueDate < t) stats.overdue++;
    if (!task.completed && task.startDate === t) stats.startingToday++;
    if (!task.completed && task.dueDate === t) stats.dueToday++;
    return stats;
  }, { total: 0, completed: 0, overdue: 0, startingToday: 0, dueToday: 0 });
}

async function sendTestEmail(id, env) {
  const task = await getTask(id, env);
  if (!task) throw new Error('Task not found.');

  await sendEmail(env, {
    to: task.email,
    subject: `TEST EMAIL: ${task.task}`,
    text:
      `This is a test email from Task Manager.\n\n` +
      `Task: ${task.task}\n` +
      `Start Date: ${task.start_date || 'Not set'}\n` +
      `Due Date: ${task.due_date || 'Not set'}\n` +
      `Notes: ${task.notes || ''}`
  });

  return { success: true, message: `Test email sent to ${task.email}` };
}

async function checkTaskReminders(env) {
  const t = todayISO();
  const { results } = await env.DB.prepare(
    `SELECT * FROM tasks WHERE completed = 0 AND email IS NOT NULL AND email != ''`
  ).all();

  let sent = 0;

  for (const task of results || []) {
    if (task.start_date === t && !task.start_email_sent) {
      await sendEmail(env, {
        to: task.email,
        subject: `Task Starting Today: ${task.task}`,
        text:
          `Task: ${task.task}\n` +
          `Start Date: ${task.start_date}\n` +
          `Due Date: ${task.due_date || 'Not set'}\n` +
          `Notes: ${task.notes || ''}`
      });
      await env.DB.prepare('UPDATE tasks SET start_email_sent = 1, updated_at = datetime(\'now\') WHERE id = ?').bind(task.id).run();
      sent++;
    }

    if (task.due_date === t && !task.due_email_sent) {
      await sendEmail(env, {
        to: task.email,
        subject: `Task Due Today: ${task.task}`,
        text:
          `Task: ${task.task}\n` +
          `Due Date: ${task.due_date}\n` +
          `Start Date: ${task.start_date || 'Not set'}\n` +
          `Notes: ${task.notes || ''}`
      });
      await env.DB.prepare('UPDATE tasks SET due_email_sent = 1, updated_at = datetime(\'now\') WHERE id = ?').bind(task.id).run();
      sent++;
    }

    if (task.due_date && task.due_date < t && !task.overdue_email_sent) {
      await sendEmail(env, {
        to: task.email,
        subject: `Task Overdue: ${task.task}`,
        text:
          `Task: ${task.task}\n` +
          `Due Date: ${task.due_date}\n` +
          `Status: OVERDUE\n` +
          `Notes: ${task.notes || ''}`
      });
      await env.DB.prepare('UPDATE tasks SET overdue_email_sent = 1, updated_at = datetime(\'now\') WHERE id = ?').bind(task.id).run();
      sent++;
    }
  }

  return { success: true, message: `Reminder check completed. Emails sent: ${sent}.`, emailsSent: sent };
}

async function resetEmailFlags(env) {
  await env.DB.prepare(
    `UPDATE tasks SET start_email_sent = 0, due_email_sent = 0, overdue_email_sent = 0, updated_at = datetime('now')`
  ).run();
  return { success: true, message: 'Email flags reset.' };
}

async function getTask(id, env) {
  return env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
}

async function assertTaskExists(id, env) {
  const task = await getTask(id, env);
  if (!task) throw new Error('Task not found.');
  return task;
}

async function sendEmail(env, { to, subject, text }) {
  if (!env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is missing. Add it with: wrangler secret put RESEND_API_KEY');
  }

  const from = env.FROM_EMAIL || 'Task Manager <onboarding@resend.dev>';

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ from, to, subject, text })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Email failed: ${errorText}`);
  }

  return response.json();
}
