// Function única que atende /api/* (ver redirect em netlify.toml).
const { handleRequest } = require("../../backend/src/router");

exports.handler = async (event) => {
  const res = await handleRequest({
    method: event.httpMethod,
    path: event.path,
    headers: event.headers || {},
    body: event.body || "",
    ip: (event.headers && event.headers["x-forwarded-for"]) || null,
  });
  return {
    statusCode: res.status,
    headers: res.headers,
    body: res.body,
    isBase64Encoded: !!res.isBase64Encoded,
  };
};
