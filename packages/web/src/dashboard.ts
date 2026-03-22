/**
 * Renders a complete HTML page for the Ultracoder dashboard.
 * No external dependencies — all CSS and JS are inline.
 */
export function renderDashboardHTML(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ultracoder Dashboard</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f1117; color: #e1e4e8; line-height: 1.5; }
  .container { max-width: 1200px; margin: 0 auto; padding: 1.5rem; }
  h1 { font-size: 1.75rem; font-weight: 600; margin-bottom: 1rem; color: #f0f0f0; }
  .status-bar { display: flex; gap: 1.5rem; margin-bottom: 1.5rem; padding: 1rem; background: #161b22; border: 1px solid #30363d; border-radius: 8px; }
  .status-bar .stat { display: flex; flex-direction: column; }
  .status-bar .stat-label { font-size: 0.75rem; text-transform: uppercase; color: #8b949e; letter-spacing: 0.05em; }
  .status-bar .stat-value { font-size: 1.5rem; font-weight: 700; }
  .stat-value.total { color: #58a6ff; }
  .stat-value.active { color: #3fb950; }
  .stat-value.failed { color: #f85149; }
  #sessions { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 1rem; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem; transition: border-color 0.15s; }
  .card:hover { border-color: #58a6ff; }
  .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
  .card-id { font-size: 0.85rem; font-family: monospace; color: #8b949e; }
  .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }
  .badge-working { background: #1f6feb33; color: #58a6ff; }
  .badge-spawning { background: #8b5cf633; color: #a78bfa; }
  .badge-pr_open, .badge-review_pending, .badge-approved, .badge-mergeable { background: #3fb95033; color: #3fb950; }
  .badge-merged, .badge-archived { background: #8b949e33; color: #8b949e; }
  .badge-failed, .badge-ci_failed, .badge-killed { background: #f8514933; color: #f85149; }
  .badge-changes_requested, .badge-merge_conflicts { background: #d2992233; color: #d29922; }
  .card-task { font-size: 0.9rem; margin-bottom: 0.5rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card-meta { font-size: 0.8rem; color: #8b949e; display: flex; gap: 1rem; }
  .empty { text-align: center; padding: 3rem; color: #8b949e; }
  .connection-status { font-size: 0.75rem; color: #8b949e; margin-left: auto; }
  .connection-status.connected { color: #3fb950; }
  .connection-status.disconnected { color: #f85149; }
  .header-row { display: flex; align-items: baseline; gap: 1rem; margin-bottom: 1rem; }
</style>
</head>
<body>
<div class="container">
  <div class="header-row">
    <h1>Ultracoder Dashboard</h1>
    <span id="conn" class="connection-status">Connecting...</span>
  </div>
  <div class="status-bar">
    <div class="stat"><span class="stat-label">Total</span><span id="total" class="stat-value total">0</span></div>
    <div class="stat"><span class="stat-label">Active</span><span id="active" class="stat-value active">0</span></div>
    <div class="stat"><span class="stat-label">Failed</span><span id="failed-count" class="stat-value failed">0</span></div>
  </div>
  <div id="sessions"><div class="empty">Loading sessions...</div></div>
</div>
<script>
(function() {
  var sessionsEl = document.getElementById("sessions");
  var totalEl = document.getElementById("total");
  var activeEl = document.getElementById("active");
  var failedEl = document.getElementById("failed-count");
  var connEl = document.getElementById("conn");

  var ACTIVE_STATUSES = ["spawning", "working", "pr_open", "review_pending"];
  var FAILED_STATUSES = ["failed", "ci_failed", "killed"];

  function truncate(s, n) { return s && s.length > n ? s.slice(0, n) + "..." : s || ""; }

  function renderSessions(sessions) {
    if (!sessions || sessions.length === 0) {
      sessionsEl.innerHTML = '<div class="empty">No sessions found</div>';
      totalEl.textContent = "0"; activeEl.textContent = "0"; failedEl.textContent = "0";
      return;
    }
    totalEl.textContent = String(sessions.length);
    activeEl.textContent = String(sessions.filter(function(s) { return ACTIVE_STATUSES.indexOf(s.status) !== -1; }).length);
    failedEl.textContent = String(sessions.filter(function(s) { return FAILED_STATUSES.indexOf(s.status) !== -1; }).length);

    sessionsEl.innerHTML = sessions.map(function(s) {
      return '<div class="card">' +
        '<div class="card-header">' +
          '<span class="card-id">' + s.id.slice(0, 12) + '</span>' +
          '<span class="badge badge-' + s.status + '">' + s.status.replace(/_/g, " ") + '</span>' +
        '</div>' +
        '<div class="card-task">' + truncate(s.task, 80) + '</div>' +
        '<div class="card-meta">' +
          '<span>' + s.agentType + '</span>' +
          '<span>' + s.branch + '</span>' +
        '</div>' +
      '</div>';
    }).join("");
  }

  function load() {
    fetch("/api/sessions").then(function(r) { return r.json(); }).then(renderSessions).catch(function() {
      sessionsEl.innerHTML = '<div class="empty">Failed to load sessions</div>';
    });
  }

  load();

  var es = new EventSource("/api/events");
  es.onopen = function() { connEl.textContent = "Connected"; connEl.className = "connection-status connected"; };
  es.onerror = function() { connEl.textContent = "Disconnected"; connEl.className = "connection-status disconnected"; };
  es.onmessage = function(e) {
    try {
      var event = JSON.parse(e.data);
      if (event.type && event.type.startsWith("session.")) { load(); }
    } catch(err) { /* ignore parse errors */ }
  };
})();
</script>
</body>
</html>`;
}
