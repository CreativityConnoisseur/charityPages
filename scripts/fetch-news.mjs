#!/usr/bin/env node
// Builds assets/news.json from the feeds in scripts/news-sources.json.
//
// Phase 1 of the news plan: headlines, a short excerpt from the publisher's own
// feed, and a link back. No AI yet. A keyword filter keeps stories that are
// about Muslim communities and drops ones about violence, hate or conflict.
//
// Usage:
//   node scripts/fetch-news.mjs                 fetch every feed and rebuild
//   node scripts/fetch-news.mjs --items a.json  rebuild from saved raw items
//                                               (array of {source, title, link, date, excerpt})
//
// No dependencies; needs Node 18+ for fetch.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = path.join(ROOT, "scripts", "news-sources.json");
const OUT = path.join(ROOT, "assets", "news.json");

const MAX_AGE_DAYS = 120;   // older stories roll off
const MAX_ITEMS = 120;      // keeps news.json small
const PER_SOURCE = 25;      // so one busy outlet can't crowd out the rest
const EXCERPT_CHARS = 220;  // short excerpt only; the story stays on the publisher's site

// ---- Feed parsing (RSS 2.0 and Atom) ----

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—" };

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function text(s) {
  if (!s) return "";
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  s = decode(s);                       // entity-encoded HTML becomes real tags here
  s = s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<[^>]+>/g, " ");
  s = decode(s);
  return s.replace(/\s+/g, " ").trim();
}

function tag(block, name) {
  const m = block.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i"));
  return m ? m[1] : "";
}

function parseFeed(xml) {
  const items = [];
  const rss = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const b of rss) {
    items.push({
      title: text(tag(b, "title")),
      link: text(tag(b, "link")) || text(tag(b, "guid")),
      date: text(tag(b, "pubDate")) || text(tag(b, "dc:date")),
      excerpt: text(tag(b, "description")),
      categories: (b.match(/<category[^>]*>[\s\S]*?<\/category>/gi) || []).map((c) => text(c)),
    });
  }
  const atom = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of atom) {
    const href = (b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)/i) || b.match(/<link[^>]*href=["']([^"']+)/i) || [])[1];
    items.push({
      title: text(tag(b, "title")),
      link: href ? decode(href) : "",
      date: text(tag(b, "published")) || text(tag(b, "updated")),
      excerpt: text(tag(b, "summary")) || text(tag(b, "content")),
      categories: [],
    });
  }
  return items;
}

// ---- Keyword filter ----
// Words are matched at word starts, case-insensitive. Kept deliberately simple;
// phase 2 replaces this with an AI score for positivity and locality.

const MUSLIM = ["muslim", "mosque", "masjid", "islam", "ramadan", "eid", "iftar", "imam", "zakat", "sadaqah", "hajj", "umrah", "qur", "halal", "jumu", "hijab", "dawah", "ummah"];

const NEGATIVE = [
  "attack", "arson", "assault", "bomb", "kill", "dead!", "death", "died", "murder", "shoot", "shot", "stab",
  "terror", "extremi", "radicali", "violen", "war!", "wars!", "genocide", "massacre", "airstrike", "hostage", "invasion",
  "hate crime", "hatred", "islamophob", "racis", "discriminat", "harass", "abuse", "misconduct", "threat",
  "charged", "arrest", "convict", "sentenced", "lawsuit", "sued", "defamation", "ban!", "banned", "military", "army", "pay gap", "less than", "less likely", "inequal", "polytheis", "criticis", "warns", "warning", "crackdown",
  "protest", "riot", "expel", "deport", "backlash", "scandal", "exposed", "controvers", "condemn", "slam",
  "accus", "allegation", "fraud", "corrupt", "famine", "starv", "flood", "earthquake", "crisis", "collapse",
  "election", "campaign", "senator", "parliament", "minister", "israel", "gaza", "zionis", "trump", "polic",
];

const POSITIVE = [
  "celebrat", "volunteer", "donat", "charity", "fundrais", "raise", "open", "launch", "welcome", "community",
  "help", "support", "feed", "meal", "food bank", "pantry", "free", "youth", "student", "school", "scholar",
  "graduat", "award", "honour", "honor", "win", "first", "inspir", "kind", "gift", "together", "unity",
  "interfaith", "neighbo", "build", "garden", "learn", "class", "book", "art", "festival", "iftar", "eid",
  "family", "marriage", "mentor", "health", "clinic", "hope", "gratitude", "mercy", "peace",
];

const TOPICS = {
  community: ["community", "neighbo", "local", "volunteer", "together", "welcome", "open house"],
  charity: ["charity", "donat", "giving", "endowment", "housing", "fundrais", "zakat", "sadaqah", "food bank", "pantry", "meal", "feed", "relief"],
  youth: ["youth", "young", "student", "school", "children", "kids", "university", "scholarship", "graduat", "teen"],
  interfaith: ["interfaith", "church", "synagogue", "christian", "jewish", "faith leaders", "neighbo"],
  seasons: ["ramadan", "eid", "iftar", "hajj", "umrah", "laylat", "muharram", "mawlid", "adha", "fitr"],
  learning: ["learn", "education", "quran", "qur'an", "prophet", "history", "scholar", "book", "knowledge", "character", "faith"],
};

// A trailing "!" means whole word only, so "war!" skips "warm" and "Warsaw".
function hits(hay, words) {
  return words.filter((w) => {
    const whole = w.endsWith("!");
    const body = (whole ? w.slice(0, -1) : w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[^a-z])" + body + (whole ? "($|[^a-z])" : ""), "i").test(hay);
  });
}

function classify(item, source) {
  const head = item.title.toLowerCase();
  const hay = (item.title + " " + item.excerpt + " " + (item.categories || []).join(" ")).toLowerCase();
  if (source.focus !== "muslim" && hits(hay, MUSLIM).length === 0) return { keep: false, why: "not about Muslims" };
  const neg = hits(head, NEGATIVE).concat(hits(item.excerpt.toLowerCase().slice(0, 300), NEGATIVE));
  if (neg.length) return { keep: false, why: "negative: " + neg.slice(0, 3).join(", ") };
  const pos = hits(hay, POSITIVE).length;
  const topics = Object.keys(TOPICS).filter((t) => hits(hay, TOPICS[t]).length);
  return { keep: true, score: pos, topics };
}

// ---- Build ----

function excerpt(s) {
  s = s.replace(/\s*(The post .* appeared first on .*|Read more.*|Continue reading.*)$/i, "").trim();
  if (s.length <= EXCERPT_CHARS) return s;
  return s.slice(0, s.lastIndexOf(" ", EXCERPT_CHARS)).replace(/[,;:.\s]+$/, "") + "…";
}

function cleanLink(link) {
  try {
    const u = new URL(link);
    if (!/^https?:$/.test(u.protocol)) return "";
    ["utm_source", "utm_medium", "utm_campaign", "preview"].forEach((k) => u.searchParams.delete(k));
    return u.toString();
  } catch { return ""; }
}

async function fetchSource(src) {
  const res = await fetch(src.feed, {
    headers: { "User-Agent": "MasjidGoodNews/1.0 (feed reader; links back to publishers)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return parseFeed(await res.text()).map((it) => ({ ...it, source: src.name }));
}

async function main() {
  const { sources } = JSON.parse(await readFile(SOURCES, "utf8"));
  const bySource = Object.fromEntries(sources.map((s) => [s.name, s]));
  const fromFile = process.argv.indexOf("--items");

  let raw = [];
  const status = [];
  if (fromFile > -1) {
    raw = JSON.parse(await readFile(process.argv[fromFile + 1], "utf8"));
  } else {
    for (const src of sources) {
      try {
        const items = await fetchSource(src);
        raw.push(...items);
        status.push({ source: src.name, ok: true, items: items.length });
      } catch (e) {
        status.push({ source: src.name, ok: false, error: String(e.message || e) });
      }
    }
  }

  // Keep the previous run's stories if a feed is down this time.
  let previous = [];
  try { previous = JSON.parse(await readFile(OUT, "utf8")).items || []; } catch { /* first run */ }

  const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
  const seen = new Set();
  const kept = [];
  const counts = {};
  const dropped = [];

  for (const it of raw) {
    const src = bySource[it.source];
    if (!src) continue;
    const link = cleanLink(it.link);
    const time = Date.parse(it.date);
    if (!link || !it.title || isNaN(time) || time < cutoff) continue;
    const key = link.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const c = classify(it, src);
    if (!c.keep) { dropped.push(it.source + ": " + it.title + " (" + c.why + ")"); continue; }
    counts[src.name] = (counts[src.name] || 0) + 1;
    if (counts[src.name] > PER_SOURCE) continue;
    kept.push({
      title: it.title,
      link,
      date: new Date(time).toISOString(),
      source: src.name,
      sourceUrl: src.site,
      region: src.region,
      topics: c.topics,
      excerpt: excerpt(it.excerpt),
    });
  }

  const liveSources = new Set(status.filter((s) => s.ok).map((s) => s.source));
  for (const p of previous) {
    const key = p.link.replace(/\/$/, "").toLowerCase();
    if (!liveSources.has(p.source) && fromFile < 0 && !seen.has(key) && Date.parse(p.date) >= cutoff && bySource[p.source]) {
      seen.add(key);
      kept.push(p);
    }
  }

  kept.sort((a, b) => b.date.localeCompare(a.date));
  const items = kept.slice(0, MAX_ITEMS);
  const out = { updated: new Date().toISOString(), sources: sources.map(({ name, site, region }) => ({ name, site, region })), items };
  await writeFile(OUT, JSON.stringify(out, null, 1) + "\n");

  console.log("Kept " + items.length + " stories, dropped " + dropped.length + ".");
  status.forEach((s) => console.log((s.ok ? "  ok   " : "  FAIL ") + s.source + (s.ok ? " (" + s.items + " items)" : " " + s.error)));
  if (process.env.SHOW_DROPPED) dropped.forEach((d) => console.log("  - " + d));
}

main().catch((e) => { console.error(e); process.exit(1); });
