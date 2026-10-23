'use strict';
// Short-lived storage for articles extracted for reader mode.
const articles = new Map();
let counter = 0;

function put(article) {
  const id = `${Date.now().toString(36)}${(counter++).toString(36)}`;
  articles.set(id, article);
  if (articles.size > 30) articles.delete(articles.keys().next().value);
  return id;
}

function get(id) {
  return articles.get(id) || null;
}

module.exports = { put, get };
