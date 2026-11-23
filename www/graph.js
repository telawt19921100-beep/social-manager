// Facebook Graph API client. Tokens are supplied by the page owner in Settings; never hard-coded.
const GRAPH = "https://graph.facebook.com/v19.0";

export async function graphGet(path, token, params = {}) {
  const url = new URL(GRAPH + path);
  url.search = new URLSearchParams({ ...params, access_token: token }).toString();
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

export async function graphPost(path, token, body) {
  const res = await fetch(GRAPH + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, access_token: token }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

// Recent comments on the page's posts.
export async function listComments(pageId, token) {
  const posts = await graphGet(`/${pageId}/posts`, token, { fields: "id", limit: 10 });
  const out = [];
  for (const p of posts.data || []) {
    const c = await graphGet(`/${p.id}/comments`, token, { fields: "id,message,from,created_time", limit: 25 });
    for (const item of c.data || []) out.push({ kind: "comment", id: item.id, text: item.message, from: item.from?.name, time: item.created_time });
  }
  return out;
}

// Reply to a comment (requires pages_manage_engagement / pages_read_user_content).
export function replyToComment(commentId, token, message) {
  return graphPost(`/${commentId}/comments`, token, { message });
}

// Hide a comment from the public (reversible). Page must own the post.
export function hideComment(commentId, token) {
  return graphPost(`/${commentId}`, token, { is_hidden: true });
}

// Permanently delete a comment on the page's own post.
export async function deleteComment(commentId, token) {
  const res = await fetch(`${GRAPH}/${commentId}?access_token=${encodeURIComponent(token)}`, { method: "DELETE" });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

// Publish a post on the page feed.
export function publishPost(pageId, token, message) {
  return graphPost(`/${pageId}/feed`, token, { message });
}
