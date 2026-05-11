import indexHtml from "./index.html";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Serve frontend
    if (url.pathname === "/") {
      return new Response(indexHtml, {
        headers: {
          "Content-Type": "text/html"
        }
      });
    }

    // GET TASKS
    if (url.pathname === "/api/tasks" && request.method === "GET") {
      const { results } = await env.DB.prepare(`
        SELECT *
        FROM tasks
        ORDER BY due_date ASC
      `).all();

      return Response.json(results);
    }

    // ADD TASK
    if (url.pathname === "/api/tasks" && request.method === "POST") {
      const body = await request.json();

      await env.DB.prepare(`
        INSERT INTO tasks (
          task,
          start_date,
          due_date,
          email,
          completed,
          start_email_sent,
          due_email_sent,
          overdue_email_sent,
          notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        body.task,
        body.start_date || null,
        body.due_date || null,
        body.email,
        0,
        0,
        0,
        0,
        body.notes || ""
      ).run();

      return Response.json({
        success: true
      });
    }

    // UPDATE TASK
    if (url.pathname.startsWith("/api/tasks/") && request.method === "PUT") {
      const id = url.pathname.split("/").pop();
      const body = await request.json();

      await env.DB.prepare(`
        UPDATE tasks
        SET
          task = ?,
          start_date = ?,
          due_date = ?,
          email = ?,
          completed = ?,
          notes = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(
        body.task,
        body.start_date || null,
        body.due_date || null,
        body.email,
        body.completed ? 1 : 0,
        body.notes || "",
        id
      ).run();

      return Response.json({
        success: true
      });
    }

    // DELETE TASK
    if (url.pathname.startsWith("/api/tasks/") && request.method === "DELETE") {
      const id = url.pathname.split("/").pop();

      await env.DB.prepare(`
        DELETE FROM tasks
        WHERE id = ?
      `).bind(id).run();

      return Response.json({
        success: true
      });
    }

    // DASHBOARD STATS
    if (url.pathname === "/api/stats") {
      const { results } = await env.DB.prepare(`
        SELECT * FROM tasks
      `).all();

      const today = new Date().toISOString().split("T")[0];

      const stats = {
        total: results.length,
        completed: 0,
        overdue: 0,
        dueToday: 0,
        startingToday: 0
      };

      results.forEach(task => {
        if (task.completed) {
          stats.completed++;
        }

        if (!task.completed && task.due_date < today) {
          stats.overdue++;
        }

        if (!task.completed && task.due_date === today) {
          stats.dueToday++;
        }

        if (!task.completed && task.start_date === today) {
          stats.startingToday++;
        }
      });

      return Response.json(stats);
    }

    return new Response("Not Found", {
      status: 404
    });
  },

  // HOURLY CRON REMINDERS
  async scheduled(event, env) {
    const today = new Date().toISOString().split("T")[0];

    const { results } = await env.DB.prepare(`
      SELECT *
      FROM tasks
      WHERE completed = 0
    `).all();

    for (const task of results) {

      // STARTING TODAY
      if (
        task.start_date === today &&
        !task.start_email_sent
      ) {

        await sendEmail(
          env,
          task.email,
          `Task Starting Today: ${task.task}`,
          `
Task: ${task.task}

Start Date: ${task.start_date}

Due Date: ${task.due_date || "Not set"}

Notes:
${task.notes || ""}
`
        );

        await env.DB.prepare(`
          UPDATE tasks
          SET start_email_sent = 1
          WHERE id = ?
        `).bind(task.id).run();
      }

      // DUE TODAY
      if (
        task.due_date === today &&
        !task.due_email_sent
      ) {

        await sendEmail(
          env,
          task.email,
          `Task Due Today: ${task.task}`,
          `
Task: ${task.task}

Due Date: ${task.due_date}

Notes:
${task.notes || ""}
`
        );

        await env.DB.prepare(`
          UPDATE tasks
          SET due_email_sent = 1
          WHERE id = ?
        `).bind(task.id).run();
      }

      // OVERDUE
      if (
        task.due_date &&
        task.due_date < today &&
        !task.overdue_email_sent
      ) {

        await sendEmail(
          env,
          task.email,
          `Task Overdue: ${task.task}`,
          `
Task: ${task.task}

Due Date: ${task.due_date}

STATUS: OVERDUE

Notes:
${task.notes || ""}
`
        );

        await env.DB.prepare(`
          UPDATE tasks
          SET overdue_email_sent = 1
          WHERE id = ?
        `).bind(task.id).run();
      }
    }
  }
};

// EMAIL FUNCTION
async function sendEmail(env, to, subject, text) {

  if (!env.RESEND_API_KEY || !env.FROM_EMAIL) {
    console.log("Email secrets missing.");
    return;
  }

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to,
      subject,
      text
    })
  });
}
