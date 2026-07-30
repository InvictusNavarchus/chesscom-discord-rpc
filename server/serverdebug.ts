// For debugging payload given
Bun.serve({
  port: 3344,
  async fetch(req) {
    const url = new URL(req.url);
    const body = await req.text();
    const json = JSON.parse(body);

    console.log(`\n${req.method} ${url.pathname}`);
    console.log("Headers:", Object.fromEntries(req.headers));
    console.log("Body:", JSON.stringify(json, null, 2));

    return new Response("OK", { status: 200 });
  },
});

console.log("Listening on http://localhost:3344");