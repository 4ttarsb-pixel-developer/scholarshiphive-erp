// OPTIONAL cut-over Worker. Deploy manually (wrangler deploy --main src/index.readonly.js)
// only AFTER data has been exported to PostgreSQL. It stops old APKs from writing to D1
// and tells users to install the updated app. Read-only GET "/" health is kept.
const MESSAGE = 'Attendance has moved to the new Workforce ERP server. Please install the latest Attendance app from your administrator.';
export default {
  async fetch(request) {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') return new Response(JSON.stringify({ success: true, retired: true, message: MESSAGE }), { headers });
    return new Response(JSON.stringify({ success: false, allowed: false, eligible: false, message: MESSAGE }), { status: 410, headers });
  },
};
