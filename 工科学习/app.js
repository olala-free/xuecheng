/* 工科知识图谱 · 交互式思维导图
   章 → 节 → 知识点，左→右树布局，纯前端、无依赖。 */
(() => {
  "use strict";

  /* ---------------- 基础工具 ---------------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const truncate = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

  const escapeHTML = (value) =>
    String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));

  // 简介里的 `…` 转成行内公式/符号
  const inline = (value) =>
    escapeHTML(value).replace(/`([^`]+)`/g, "<code>$1</code>");

  const pad2 = (n) => String(n).padStart(2, "0");

  function readJSON(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value == null ? fallback : value;
    } catch (err) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* 本地文件或隐私模式下忽略 */
    }
  }

  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- 尺寸与布局常量 ---------------- */

  const NODE_W = { root: 200, chapter: 216, section: 200, point: 254 };
  const NODE_H = { root: 150, chapter: 68, section: 48, point: 44 };
  // root → chapter → section → point
  const COL_X = { root: 0, chapter: 300, section: 552, point: 788 };
  const GAP_Y = { chapter: 22, section: 12, point: 8 };
  const TOP_PAD = 40;
  const ANIM_MS = 360;

  /* ---------------- 数据规范化 ---------------- */

  const RAW_COURSES = Array.isArray(window.COURSES) ? window.COURSES : [];

  function normalizeCourse(raw, ci) {
    const course = {
      ci,
      id: raw.id || "course-" + ci,
      name: raw.name || "未命名课程",
      short: raw.short || raw.name || "课程",
      edition: raw.edition || "",
      mark: raw.mark || "·",
      color: raw.color || "#b23a2b",
      intro: raw.intro || "",
      chapters: [],
      sections: [],
      allPoints: [],
      byId: new Map(),
    };

    const root = {
      kind: "root",
      id: "c" + ci + "-root",
      course,
      name: course.name,
      depth: 0,
      parent: null,
      x: 0,
      y: 0,
      h: NODE_H.root,
    };
    course.root = root;
    course.byId.set(root.id, root);

    (Array.isArray(raw.chapters) ? raw.chapters : []).forEach((rawCh, chi) => {
      const ch = {
        kind: "chapter",
        id: "c" + ci + "-ch" + (chi + 1),
        course,
        name: rawCh.t || "未命名章",
        intro: rawCh.intro || "",
        no: pad2(chi + 1),
        noLabel: "第 " + (chi + 1) + " 章",
        index: chi,
        depth: 1,
        parent: root,
        sections: [],
        pointCount: 0,
        x: 0,
        y: 0,
        h: NODE_H.chapter,
      };
      course.chapters.push(ch);
      course.byId.set(ch.id, ch);

      (Array.isArray(rawCh.secs) ? rawCh.secs : []).forEach((rawSec, si) => {
        const sec = {
          kind: "section",
          id: ch.id + "-s" + (si + 1),
          course,
          chapter: ch,
          name: rawSec.t || "未命名节",
          no: chi + 1 + "." + (si + 1),
          index: si,
          depth: 2,
          parent: ch,
          points: [],
          x: 0,
          y: 0,
          h: NODE_H.section,
        };
        ch.sections.push(sec);
        course.sections.push(sec);
        course.byId.set(sec.id, sec);

        (Array.isArray(rawSec.pts) ? rawSec.pts : []).forEach((pt, pi) => {
          const rich = pt && typeof pt === "object" && !Array.isArray(pt);
          const point = {
            kind: "point",
            id: sec.id + "-p" + (pi + 1),
            course,
            chapter: ch,
            section: sec,
            name: (rich ? pt.t : pt[0]) || "未命名知识点",
            desc: (rich ? pt.intro || pt.def : pt[1]) || "",
            def: rich ? pt.def || "" : "",
            formula: rich && Array.isArray(pt.formula) ? pt.formula.filter((x) => typeof x === "string" && x.trim()) : [],
            symbols: rich && Array.isArray(pt.symbols) ? pt.symbols.filter((x) => Array.isArray(x) && x.length >= 2) : [],
            notes: rich && Array.isArray(pt.notes) ? pt.notes.filter((x) => typeof x === "string" && x.trim()) : [],
            no: chi + 1 + "." + (si + 1) + "." + (pi + 1),
            index: pi,
            seq: course.allPoints.length,
            depth: 3,
            parent: sec,
            x: 0,
            y: 0,
            h: NODE_H.point,
          };
          point.searchText = [
            point.name,
            point.desc,
            point.def,
            ...point.formula,
            ...point.symbols.flat(),
            ...point.notes,
          ].join(" ").toLowerCase();
          sec.points.push(point);
          course.allPoints.push(point);
          course.byId.set(point.id, point);
        });

        ch.pointCount += sec.points.length;
      });
    });

    course.chapterCount = course.chapters.length;
    course.sectionCount = course.sections.length;
    course.pointCount = course.allPoints.length;
    return course;
  }

  const courses = RAW_COURSES.map(normalizeCourse);

  const searchNodes = [];
  const globalById = new Map();
  courses.forEach((c) => {
    [c.root, ...c.chapters, ...c.sections, ...c.allPoints].forEach((n) => {
      searchNodes.push(n);
      globalById.set(n.id, n);
    });
  });

  const savedCi = parseInt(localStorage.getItem("gk-ci"), 10);
  const initialCi = Number.isInteger(savedCi) && savedCi >= 0 && savedCi < courses.length ? savedCi : 0;

  const masteredIds = readJSON("gk-mastered-v1", []);
  const state = {
    ci: initialCi,
    focus: null,
    selected: null,
    expanded: new Set(),
    mastered: new Set(Array.isArray(masteredIds) ? masteredIds.filter((id) => typeof id === "string") : []),
    query: "",
    scale: 1,
    panX: 0,
    panY: 0,
    theme: "light",
    detailOpen: false,
    preSearch: null,
    searchMatchIds: new Set(),
    searchAncestorIds: new Set(),
    searchHasCurrent: false,
  };

  let course = courses[state.ci];

  /* ---------------- DOM ---------------- */

  const app = $("#app");
  const tabsEl = $("#courseTabs");
  const courseHead = $("#courseHead");
  const sideCount = $("#sideCount");
  const allChaptersBtn = $("#allChapters");
  const allCount = $("#allCount");
  const chapterList = $("#chapterList");
  const progressCount = $("#progressCount");
  const progressBar = $("#progressBar");
  const crumbsEl = $("#crumbs");
  const levelSeg = $("#levelSeg");
  const zoomLabel = $("#zoomLabel");
  const fitBtn = $("#fitBtn");
  const viewport = $("#viewport");
  const world = $("#world");
  const linksSvg = $("#links");
  const nodesLayer = $("#nodes");
  const watermark = $("#watermark");
  const searchInput = $("#searchInput");
  const searchPanel = $("#searchPanel");
  const detail = $("#detail");
  const hint = $("#hint");
  const themeBtn = $("#themeBtn");
  const menuBtn = $("#menuBtn");
  const zoomOut = $("#zoomOut");
  const zoomIn = $("#zoomIn");
  const zoomFit = $("#zoomFit");

  if (!courses.length) {
    document.body.innerHTML = '<div style="padding:40px;font:16px sans-serif">没有找到课程数据，请确认 data 目录与页面在同一位置。</div>';
    return;
  }

  /* ---------------- 主题 ---------------- */

  const SUN_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>';

  const MOON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5Z"></path></svg>';

  function accentFor(color) {
    const c = color || "#b23a2b";
    return state.theme === "dark" ? "color-mix(in srgb, " + c + " 52%, #f3eee2)" : c;
  }

  function applyAccent() {
    const base = course ? course.color : "#b23a2b";
    document.documentElement.style.setProperty("--accent", accentFor(base));
    $$(".tab", tabsEl).forEach((tab, i) => {
      if (courses[i]) tab.style.setProperty("--accent", accentFor(courses[i].color));
    });
  }

  function setTheme(theme, silent) {
    state.theme = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = state.theme;
    applyAccent();
    themeBtn.innerHTML = state.theme === "dark" ? SUN_SVG : MOON_SVG;
    themeBtn.setAttribute("aria-label", state.theme === "dark" ? "切换到浅色主题" : "切换到深色主题");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", state.theme === "dark" ? "#141713" : "#f3eee2");
    if (!silent) writeJSON("gk-theme", state.theme);
  }

  /* ---------------- 顶栏 / 侧栏 ---------------- */

  function renderTabs() {
    tabsEl.innerHTML = courses
      .map(
        (c, i) =>
          '<button type="button" class="tab' + (i === state.ci ? " active" : "") + '" data-ci="' + i + '" style="--accent:' + escapeHTML(accentFor(c.color)) + '" aria-label="' + escapeHTML(c.name) + '" aria-pressed="' + (i === state.ci ? "true" : "false") + '">' +
          '<span class="tab-mark">' + escapeHTML(c.mark) + "</span>" +
          '<span class="tab-name">' + escapeHTML(c.short) + "</span></button>"
      )
      .join("");
  }

  function syncTabs() {
    $$(".tab", tabsEl).forEach((tab, i) => {
      const active = i === state.ci;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function renderCourseHead() {
    courseHead.innerHTML =
      '<div class="course-head-top">' +
      '<div class="course-mark" aria-hidden="true">' + escapeHTML(course.mark) + "</div>" +
      "<div>" +
      '<div class="course-edition">' + escapeHTML(course.edition) + "</div>" +
      "<h2>" + escapeHTML(course.name) + "</h2>" +
      "</div></div>" +
      (course.intro ? '<p class="course-intro">' + inline(course.intro) + "</p>" : "");
    watermark.textContent = course.mark;
    document.title = course.short + " · 工科知识图谱";
  }

  function masteredInPoints(points) {
    let n = 0;
    for (const p of points) if (state.mastered.has(p.id)) n += 1;
    return n;
  }

  function renderSidebar() {
    sideCount.textContent = course.chapterCount + " 章 · " + course.sectionCount + " 节";
    allCount.textContent = String(course.chapterCount);
    allChaptersBtn.classList.toggle("active", !state.focus);

    chapterList.innerHTML = course.chapters
      .map((ch) => {
        const done = ch.sections.reduce((sum, sec) => sum + masteredInPoints(sec.points), 0);
        const pct = ch.pointCount ? Math.round((done / ch.pointCount) * 100) : 0;
        const active = state.focus === ch.id;
        return (
          '<button type="button" class="chapter-btn' + (active ? " active" : "") + '" data-ch="' + ch.id + '" title="' + escapeHTML(ch.name) + '">' +
          '<span class="ch-no">' + escapeHTML(ch.no) + "</span>" +
          '<span class="ch-title">' + escapeHTML(ch.name) + "</span>" +
          '<span class="ch-count">' + ch.sections.length + " 节</span>" +
          '<span class="ch-bar"><i style="width:' + pct + '%"></i></span>' +
          "</button>"
        );
      })
      .join("");

    const total = course.pointCount;
    const done = masteredInPoints(course.allPoints);
    const pct = total ? Math.round((done / total) * 100) : 0;
    progressCount.textContent = done + " / " + total;
    progressBar.style.width = pct + "%";
    progressBar.parentElement.setAttribute("aria-label", "掌握进度 " + pct + "%");
  }

  /* ---------------- 面包屑 ---------------- */

  function crumbLabel(n) {
    if (n.kind === "chapter") return truncate(n.name, 11);
    if (n.kind === "section") return n.no;
    if (n.kind === "point") return truncate(n.name, 13);
    return truncate(n.name, 12);
  }

  function renderCrumbs() {
    let node = state.selected ? course.byId.get(state.selected) : null;
    if (!node && state.focus) node = course.byId.get(state.focus);

    const chain = [];
    let cursor = node;
    let guard = 0;
    while (cursor && cursor.kind !== "root" && guard < 6) {
      chain.unshift(cursor);
      cursor = cursor.parent;
      guard += 1;
    }

    let html = '<button type="button" data-crumb="' + course.root.id + '">' + escapeHTML(course.short) + "</button>";
    if (!chain.length) {
      html += '<span class="slash">/</span><b>全部章节</b>';
    } else {
      chain.forEach((n, i) => {
        const last = i === chain.length - 1;
        html += '<span class="slash">/</span>';
        html += last
          ? "<b>" + escapeHTML(crumbLabel(n)) + "</b>"
          : '<button type="button" data-crumb="' + n.id + '">' + escapeHTML(crumbLabel(n)) + "</button>";
      });
    }
    crumbsEl.innerHTML = html;
  }

  /* ---------------- 树布局 ---------------- */

  function childrenOf(n) {
    if (n.kind === "root") {
      const focused = state.focus ? course.byId.get(state.focus) : null;
      return focused ? [focused] : course.chapters;
    }
    if (n.kind === "chapter") return state.expanded.has(n.id) ? n.sections : [];
    if (n.kind === "section") return state.expanded.has(n.id) ? n.points : [];
    return [];
  }

  function isIndexMode() {
    return (
      !state.focus &&
      course.chapters.length > 0 &&
      course.chapters.every((ch) => !state.expanded.has(ch.id))
    );
  }

  const INDEX_ROOT_X = 316;
  const INDEX_RIGHT_X = 616;

  function columnHeight(kids) {
    let total = 0;
    kids.forEach((kid, i) => {
      total += measure(kid);
      if (i) total += GAP_Y[kid.kind];
    });
    return total;
  }

  function measure(n) {
    const kids = childrenOf(n);
    n._kids = kids;
    if (n.kind === "root" && isIndexMode() && kids.length) {
      const split = Math.ceil(kids.length / 2);
      kids.forEach((kid, i) => {
        kid._side = i < split ? 1 : -1;
      });
      const right = kids.slice(0, split);
      const left = kids.slice(split);
      n._colSplit = split;
      n._rightH = columnHeight(right);
      n._leftH = columnHeight(left);
      n.h = Math.max(NODE_H.root, n._rightH, n._leftH);
      return n.h;
    }
    n._colSplit = 0;
    if (!kids.length) {
      n.h = NODE_H[n.kind];
      return n.h;
    }
    kids.forEach((kid) => {
      if (kid.kind === "chapter") kid._side = 0;
    });
    let total = 0;
    kids.forEach((kid, i) => {
      total += measure(kid);
      if (i) total += GAP_Y[kid.kind];
    });
    n.h = Math.max(NODE_H[n.kind], total);
    return n.h;
  }

  function place(n, x, top) {
    if (n.kind === "root" && n._colSplit) {
      const split = n._colSplit;
      const right = n._kids.slice(0, split);
      const left = n._kids.slice(split);
      n.x = INDEX_ROOT_X;
      n.y = top + (n.h - NODE_H.root) / 2;
      let cursor = top + (n.h - n._rightH) / 2;
      right.forEach((kid) => {
        place(kid, INDEX_RIGHT_X, cursor);
        cursor += kid.h + GAP_Y.chapter;
      });
      cursor = top + (n.h - n._leftH) / 2;
      left.forEach((kid) => {
        place(kid, 0, cursor);
        cursor += kid.h + GAP_Y.chapter;
      });
      return;
    }
    n.x = x;
    n.y = top + (n.h - NODE_H[n.kind]) / 2;
    const kids = n._kids || [];
    if (!kids.length) return;
    let total = 0;
    kids.forEach((kid, i) => {
      total += kid.h;
      if (i) total += GAP_Y[kid.kind];
    });
    let cursor = top + (n.h - total) / 2;
    kids.forEach((kid) => {
      place(kid, COL_X[kid.kind], cursor);
      cursor += kid.h + GAP_Y[kid.kind];
    });
  }

  function collectVisible() {
    const out = [];
    const walk = (n) => {
      out.push(n);
      childrenOf(n).forEach(walk);
    };
    if (state.focus) {
      const focused = course.byId.get(state.focus);
      if (focused) walk(focused);
      return out;
    }
    walk(course.root);
    return out;
  }

  function collectSubtree(n) {
    const out = [];
    const walk = (node) => {
      out.push(node);
      childrenOf(node).forEach(walk);
    };
    walk(n);
    return out;
  }

  function placeFocused(n, x, top) {
    n.x = x;
    n.y = top + (n.h - NODE_H[n.kind]) / 2;
    const kids = n._kids || [];
    if (!kids.length) return;
    let total = 0;
    kids.forEach((kid, i) => {
      total += kid.h;
      if (i) total += GAP_Y[kid.kind];
    });
    let cursor = top + (n.h - total) / 2;
    kids.forEach((kid) => {
      placeFocused(kid, x + NODE_W[n.kind] + 40, cursor);
      cursor += kid.h + GAP_Y[kid.kind];
    });
  }

  function layoutTree() {
    if (state.focus) {
      const focused = course.byId.get(state.focus);
      if (focused) {
        measure(focused);
        placeFocused(focused, 0, TOP_PAD);
        return collectVisible();
      }
    }
    measure(course.root);
    place(course.root, COL_X.root, TOP_PAD);
    return collectVisible();
  }

  /* ---------------- 节点 DOM ---------------- */

  const nodeEls = new Map();
  const linkEls = new Map();
  let layoutRaf = 0;

  function nodeInner(n) {
    if (n.kind === "root") {
      return (
        '<span class="root-mark" aria-hidden="true">' + escapeHTML(course.mark) + "</span>" +
        "<div>" +
        '<div class="root-name">' + escapeHTML(course.name) + "</div>" +
        '<div class="root-edition">' + escapeHTML(course.edition) + "</div>" +
        "</div>" +
        '<div class="root-stats">' + course.chapterCount + " 章 · " + course.sectionCount + " 节 · " + course.pointCount + " 点</div>"
      );
    }
    if (n.kind === "chapter") {
      return (
        '<span class="ch-line">' +
        '<span class="ch-no">' + escapeHTML(n.no) + "</span>" +
        '<span class="ch-name">' + escapeHTML(n.name) + "</span>" +
        "</span>" +
        '<span class="ch-meta"><span>' + n.sections.length + " 节 · " + n.pointCount + ' 点</span><span class="chev" aria-hidden="true">›</span></span>'
      );
    }
    if (n.kind === "section") {
      return (
        '<span class="sec-no">' + escapeHTML(n.no) + "</span>" +
        '<span class="sec-name">' + escapeHTML(n.name) + "</span>" +
        '<span class="sec-count">' + n.points.length + "</span>" +
        '<span class="chev" aria-hidden="true">›</span>'
      );
    }
    return (
      '<span class="pt-dot" aria-hidden="true"></span>' +
      '<span class="pt-name">' + escapeHTML(n.name) + "</span>" +
      '<span class="pt-tick" aria-hidden="true">✓</span>'
    );
  }

  function createNodeEl(n) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "node " + n.kind;
    el.dataset.id = n.id;
    el.style.width = NODE_W[n.kind] + "px";
    el.style.height = NODE_H[n.kind] + "px";
    el.setAttribute(
      "aria-label",
      n.kind === "point"
        ? "知识点：" + n.name
        : n.kind === "section"
          ? "节：" + n.no + " " + n.name
          : n.kind === "chapter"
            ? "第 " + (n.index + 1) + " 章：" + n.name
            : course.name
    );
    if (n.kind === "chapter" || n.kind === "section") {
      el.setAttribute("aria-expanded", "false");
    }
    el.innerHTML = nodeInner(n);
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      handleNodeClick(n);
    });
    return el;
  }

  function syncNodeClasses() {
    nodeEls.forEach((el, id) => {
      const n = course.byId.get(id);
      if (!n) return;
      const open = (n.kind === "chapter" || n.kind === "section") && state.expanded.has(id);
      el.classList.toggle("expanded", open);
      el.classList.toggle("selected", state.selected === id);
      el.classList.toggle("mastered", n.kind === "point" && state.mastered.has(id));
      el.classList.toggle("leaf", n.kind === "point" || (n.kind === "section" && n.points.length === 0));
      el.classList.toggle("left-branch", n.kind === "chapter" && n._side === -1);
      if (n.kind === "chapter" || n.kind === "section") {
        el.setAttribute("aria-expanded", open ? "true" : "false");
      }
    });
  }

  function reconcileLinks(visible, visibleIds) {
    const keep = new Set();
    visible.forEach((n) => {
      if (n.parent && visibleIds.has(n.parent.id)) keep.add(n.id);
    });

    Array.from(linkEls.keys()).forEach((id) => {
      if (!keep.has(id)) {
        const el = linkEls.get(id);
        if (el) el.remove();
        linkEls.delete(id);
      }
    });

    visible.forEach((n) => {
      if (!n.parent || !keep.has(n.id) || linkEls.has(n.id)) return;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("class", "link d" + Math.min(n.depth, 3));
      linksSvg.appendChild(path);
      linkEls.set(n.id, path);
    });
  }

  function drawLinks() {
    linkEls.forEach((path, childId) => {
      const n = course.byId.get(childId);
      if (!n || !n.parent) return;
      const pe = nodeEls.get(n.parent.id);
      const ce = nodeEls.get(childId);
      if (!pe || !ce) {
        path.setAttribute("d", "");
        return;
      }
      const parentW = NODE_W[n.parent.kind];
      const parentCx = (pe._x == null ? n.parent.x : pe._x) + parentW / 2;
      const childCx = (ce._x == null ? n.x : ce._x) + NODE_W[n.kind] / 2;
      const toLeft = childCx < parentCx;
      const x1 = (pe._x == null ? n.parent.x : pe._x) + (toLeft ? 0 : parentW);
      const y1 = (pe._y == null ? n.parent.y : pe._y) + NODE_H[n.parent.kind] / 2;
      const x2 = (ce._x == null ? n.x : ce._x) + (toLeft ? NODE_W[n.kind] : 0);
      const y2 = (ce._y == null ? n.y : ce._y) + NODE_H[n.kind] / 2;
      const dx = Math.max(26, Math.abs(x2 - x1) * 0.55);
      const c1 = toLeft ? x1 - dx : x1 + dx;
      const c2 = toLeft ? x2 + dx : x2 - dx;
      path.setAttribute("d", "M " + x1 + " " + y1 + " C " + c1 + " " + y1 + ", " + c2 + " " + y2 + ", " + x2 + " " + y2);
    });
  }

  function sizeLinkLayer(visible) {
    let maxX = 0;
    let maxY = 0;
    visible.forEach((n) => {
      maxX = Math.max(maxX, n.x + NODE_W[n.kind]);
      maxY = Math.max(maxY, n.y + NODE_H[n.kind]);
    });
    linksSvg.setAttribute("width", Math.ceil(maxX + 120));
    linksSvg.setAttribute("height", Math.ceil(maxY + 120));
  }

  function setNodeFinal(el, n) {
    el._x = n.x;
    el._y = n.y;
    el._op = 1;
    el.style.transform = "translate3d(" + n.x + "px," + n.y + "px,0)";
    el.style.opacity = "1";
  }

  function animateNodes(visible) {
    cancelAnimationFrame(layoutRaf);
    if (REDUCED) {
      visible.forEach((n) => {
        const el = nodeEls.get(n.id);
        if (el) setNodeFinal(el, n);
      });
      drawLinks();
      return;
    }

    const items = visible.map((n) => {
      const el = nodeEls.get(n.id);
      return {
        el,
        n,
        fromX: el._x == null ? n.x : el._x,
        fromY: el._y == null ? n.y : el._y,
        fromOp: el._op == null ? 0 : el._op,
      };
    });
    const t0 = performance.now();

    const frame = (now) => {
      const k = clamp((now - t0) / ANIM_MS, 0, 1);
      const ease = 1 - Math.pow(1 - k, 3);
      items.forEach((it) => {
        const x = it.fromX + (it.n.x - it.fromX) * ease;
        const y = it.fromY + (it.n.y - it.fromY) * ease;
        const op = it.fromOp + (1 - it.fromOp) * ease;
        it.el._x = x;
        it.el._y = y;
        it.el._op = op;
        it.el.style.transform = "translate3d(" + x + "px," + y + "px,0)";
        it.el.style.opacity = String(op);
      });
      drawLinks();
      if (k < 1) {
        layoutRaf = requestAnimationFrame(frame);
      } else {
        items.forEach((it) => setNodeFinal(it.el, it.n));
        drawLinks();
      }
    };
    layoutRaf = requestAnimationFrame(frame);
  }

  function renderMap(options) {
    const animate = !options || options.animate !== false;
    const visible = layoutTree();
    const visibleIds = new Set(visible.map((n) => n.id));

    Array.from(nodeEls.keys()).forEach((id) => {
      if (!visibleIds.has(id)) {
        const el = nodeEls.get(id);
        if (el) el.remove();
        nodeEls.delete(id);
      }
    });

    visible.forEach((n) => {
      let el = nodeEls.get(n.id);
      if (!el) {
        el = createNodeEl(n);
        nodesLayer.appendChild(el);
        nodeEls.set(n.id, el);
        const parentEl = n.parent ? nodeEls.get(n.parent.id) : null;
        el._x = parentEl && parentEl._x != null ? parentEl._x : n.x - 34;
        el._y = parentEl && parentEl._y != null ? parentEl._y : n.y;
        el._op = 0;
        el.style.transform = "translate3d(" + el._x + "px," + el._y + "px,0)";
        el.style.opacity = "0";
      }
    });

    reconcileLinks(visible, visibleIds);
    sizeLinkLayer(visible);
    syncNodeClasses();
    drawLinks();

    if (animate) {
      animateNodes(visible);
    } else {
      cancelAnimationFrame(layoutRaf);
      visible.forEach((n) => {
        const el = nodeEls.get(n.id);
        if (el) setNodeFinal(el, n);
      });
      drawLinks();
    }
    applySearchPaint();
  }

  /* ---------------- 视图变换 ---------------- */

  let viewRaf = 0;

  function applyWorld() {
    world.style.transform = "translate(" + state.panX + "px," + state.panY + "px) scale(" + state.scale + ")";
    zoomLabel.textContent = Math.round(state.scale * 100) + "%";
  }

  function setView(scale, panX, panY) {
    state.scale = clamp(scale, 0.16, 2.4);
    state.panX = panX;
    state.panY = panY;
    applyWorld();
  }

  function tweenView(scale, panX, panY, duration) {
    cancelAnimationFrame(viewRaf);
    const targetScale = clamp(scale, 0.16, 2.4);
    if (REDUCED || !duration) {
      setView(targetScale, panX, panY);
      return;
    }
    const s0 = state.scale;
    const x0 = state.panX;
    const y0 = state.panY;
    const t0 = performance.now();
    const frame = (now) => {
      const k = clamp((now - t0) / duration, 0, 1);
      const ease = 1 - Math.pow(1 - k, 3);
      setView(s0 + (targetScale - s0) * ease, x0 + (panX - x0) * ease, y0 + (panY - y0) * ease);
      if (k < 1) viewRaf = requestAnimationFrame(frame);
    };
    viewRaf = requestAnimationFrame(frame);
  }

  function availableArea() {
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const wide = window.innerWidth > 980;
    const aw = state.detailOpen && wide ? vw - 398 : vw;
    const ah = state.detailOpen && !wide ? vh * 0.46 : vh;
    return { vw, vh, aw: Math.max(320, aw), ah: Math.max(260, ah), wide };
  }

  function boundsOf(nodes) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    nodes.forEach((n) => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_W[n.kind]);
      maxY = Math.max(maxY, n.y + NODE_H[n.kind]);
    });
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }

  function fitBounds(nodes, opts) {
    if (!nodes.length) return;
    const padding = opts && opts.padding != null ? opts.padding : 48;
    const maxScale = opts && opts.maxScale != null ? opts.maxScale : 1.06;
    const animate = !opts || opts.animate !== false;
    const b = boundsOf(nodes);
    const area = availableArea();
    const scale = clamp(
      Math.min((area.aw - padding * 2) / Math.max(b.w, 1), (area.ah - padding * 2) / Math.max(b.h, 1)),
      0.16,
      maxScale
    );
    const panX = (area.aw - b.w * scale) / 2 - b.minX * scale;
    const panY = (area.ah - b.h * scale) / 2 - b.minY * scale;
    if (animate) tweenView(scale, panX, panY, 300);
    else setView(scale, panX, panY);
  }

  function fitAll(animate) {
    fitBounds(collectVisible(), { padding: 48, maxScale: 1.06, animate: animate !== false });
  }

  function fitRegion(n, animate) {
    if (!n) return;
    fitBounds(collectSubtree(n), { padding: 52, maxScale: 1.1, animate: animate !== false });
  }

  function centerNode(n, minScale) {
    if (!n) return;
    cancelAnimationFrame(viewRaf);
    const area = availableArea();
    const scale = clamp(minScale == null ? Math.max(state.scale, 0.68) : minScale, 0.16, 2.4);
    const cx = n.x + NODE_W[n.kind] / 2;
    const cy = n.y + NODE_H[n.kind] / 2;
    tweenView(scale, area.aw / 2 - cx * scale, area.ah / 2 - cy * scale, 280);
  }

  function ensureNodeVisible(n) {
    if (!n) return;
    const area = availableArea();
    const pad = 42;
    const left = n.x * state.scale + state.panX;
    const right = (n.x + NODE_W[n.kind]) * state.scale + state.panX;
    const top = n.y * state.scale + state.panY;
    const bottom = (n.y + NODE_H[n.kind]) * state.scale + state.panY;
    if (left >= pad && right <= area.aw - pad && top >= pad && bottom <= area.ah - pad) return;
    const dx = area.aw / 2 - (left + right) / 2;
    const dy = area.ah / 2 - (top + bottom) / 2;
    tweenView(state.scale, state.panX + dx, state.panY + dy, 240);
  }

  function autoFrame(n) {
    if (!n) return;
    if (state.focus && n.kind === "section") {
      fitBounds(collectSubtree(n), { padding: 52, maxScale: 1.06 });
      return;
    }
    const nodes = state.focus ? collectVisible() : collectSubtree(n);
    const b = boundsOf(nodes);
    const area = availableArea();
    if (b.h * state.scale > area.ah * 0.82 || b.w * state.scale > area.aw * 0.9) {
      fitBounds(nodes, { padding: 52, maxScale: 1.08 });
    } else {
      ensureNodeVisible(n);
    }
  }

  function zoomAt(factor, mx, my) {
    cancelAnimationFrame(viewRaf);
    const next = clamp(state.scale * factor, 0.16, 2.4);
    const wx = (mx - state.panX) / state.scale;
    const wy = (my - state.panY) / state.scale;
    state.scale = next;
    state.panX = mx - wx * next;
    state.panY = my - wy * next;
    applyWorld();
  }

  /* ---------------- 节点交互 ---------------- */

  function closeDetail() {
    state.detailOpen = false;
    state.selected = null;
    detail.hidden = true;
    detail.innerHTML = "";
    syncNodeClasses();
    renderCrumbs();
  }

  function selectNode(id, options) {
    const opts = options || {};
    const n = course.byId.get(id);
    if (!n) return;

    if (state.query) resetSearchUI();

    let structural = false;
    if (opts.reveal) {
      if (n.kind === "point") {
        if (!state.expanded.has(n.chapter.id)) {
          state.expanded.add(n.chapter.id);
          structural = true;
        }
        if (!state.expanded.has(n.section.id)) {
          state.expanded.add(n.section.id);
          structural = true;
        }
      } else if (n.kind === "section" && !state.expanded.has(n.chapter.id)) {
        state.expanded.add(n.chapter.id);
        structural = true;
      }
    }

    const targetChapter = n.kind === "chapter" ? n : n.chapter || null;
    if (n.kind === "root" && state.focus) {
      state.focus = null;
      state.expanded.clear();
      structural = true;
    }
    if (state.focus && targetChapter && targetChapter.id !== state.focus) {
      state.focus = null;
      structural = true;
    }

    state.selected = id;
    if (structural) renderMap({ animate: true });
    else {
      syncNodeClasses();
      applySearchPaint();
    }

    state.detailOpen = true;
    showDetail(n);
    renderCrumbs();
    renderSidebar();
    syncSeg();

    if (opts.center) requestAnimationFrame(() => centerNode(n));
    else if (n.kind === "point") requestAnimationFrame(() => ensureNodeVisible(n));
  }

  function handleNodeClick(n) {
    if (n.kind === "point" || n.kind === "root") {
      selectNode(n.id, { center: false });
      return;
    }
    if (n.kind === "chapter" && isIndexMode()) {
      focusChapter(n.id);
      return;
    }
    const wasOpen = state.expanded.has(n.id);
    if (wasOpen) state.expanded.delete(n.id);
    else state.expanded.add(n.id);
    renderMap({ animate: true });
    selectNode(n.id, { center: false });
    syncSeg();
    if (!wasOpen) requestAnimationFrame(() => autoFrame(n));
  }

  function showOverview() {
    if (state.query) resetSearchUI();
    state.focus = null;
    state.selected = null;
    state.expanded.clear();
    closeDetail();
    renderMap({ animate: true });
    renderSidebar();
    renderCrumbs();
    syncSeg();
    fitAll();
    if (window.innerWidth <= 980) document.body.classList.remove("sidebar-open");
  }

  function focusChapter(id) {
    const ch = course.byId.get(id);
    if (!ch || ch.kind !== "chapter") return;
    if (state.query) resetSearchUI();
    if (state.focus === id) {
      showOverview();
      return;
    }
    state.focus = id;
    state.expanded = new Set([id]);
    state.selected = id;
    renderMap({ animate: true });
    state.detailOpen = true;
    showDetail(ch);
    renderSidebar();
    renderCrumbs();
    syncSeg();
    requestAnimationFrame(() => fitRegion(ch));
    if (window.innerWidth <= 980) document.body.classList.remove("sidebar-open");
  }

  function syncSeg() {
    const hasSection = course.chapters.some((ch) => state.expanded.has(ch.id));
    const hasPoint = course.sections.some((sec) => state.expanded.has(sec.id));
    const level = hasPoint ? 3 : hasSection ? 2 : 1;
    $$("button", levelSeg).forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.level) === level);
    });
  }

  function setLevel(level) {
    if (level === 1) {
      showOverview();
      return;
    }
    let anchor = state.selected ? course.byId.get(state.selected) : null;
    if (!anchor && state.focus) anchor = course.byId.get(state.focus);
    let ch = anchor ? (anchor.kind === "chapter" ? anchor : anchor.chapter || null) : null;
    if (!ch) ch = course.chapters[0];
    if (!ch) return;

    if (state.query) resetSearchUI();
    state.focus = ch.id;
    state.expanded = new Set([ch.id]);
    if (level >= 3) ch.sections.forEach((sec) => state.expanded.add(sec.id));
    state.selected = ch.id;
    renderMap({ animate: true });
    state.detailOpen = true;
    showDetail(ch);
    renderSidebar();
    renderCrumbs();
    syncSeg();
    requestAnimationFrame(() => fitRegion(ch));
  }

  /* ---------------- 详情面板 ---------------- */

  function statsHTML(items) {
    return (
      '<div class="detail-stats">' +
      items.map((it) => "<div><b>" + it[0] + "</b><span>" + it[1] + "</span></div>").join("") +
      "</div>"
    );
  }

  function navHTML(prev, next, label) {
    return (
      '<div class="detail-nav">' +
      '<button type="button" data-target="' + (prev ? prev.id : "") + '"' + (prev ? "" : " disabled") + ">← 上一" + label + "</button>" +
      '<button type="button" data-target="' + (next ? next.id : "") + '"' + (next ? "" : " disabled") + ">下一" + label + " →</button>" +
      "</div>"
    );
  }

  function pointDetailHTML(n) {
    if (!n.def && !n.formula.length && !n.symbols.length && !n.notes.length) return "";

    let html = '<div class="kp-sections">';

    if (n.def) {
      html +=
        '<section class="kp-block">' +
        '<div class="kp-label"><span>01</span>名词解释</div>' +
        '<p class="kp-text">' + inline(n.def) + "</p>" +
        "</section>";
    }

    if (n.formula.length) {
      html +=
        '<section class="kp-block">' +
        '<div class="kp-label"><span>02</span>核心公式</div>' +
        '<div class="kp-formula">' +
        n.formula.map((f) => '<div class="formula-line">' + escapeHTML(f) + "</div>").join("") +
        "</div></section>";
    }

    if (n.symbols.length) {
      html +=
        '<section class="kp-block">' +
        '<div class="kp-label"><span>03</span>符号含义</div>' +
        '<dl class="kp-symbols">' +
        n.symbols
          .map(([symbol, meaning]) => "<dt>" + escapeHTML(symbol) + "</dt><dd>" + inline(meaning) + "</dd>")
          .join("") +
        "</dl></section>";
    }

    if (n.notes.length) {
      html +=
        '<section class="kp-block">' +
        '<div class="kp-label"><span>04</span>使用注意</div>' +
        '<ul class="kp-notes">' +
        n.notes.map((note) => "<li>" + inline(note) + "</li>").join("") +
        "</ul></section>";
    }

    return html + "</div>";
  }

  function itemHTML(n, count, mastered) {
    return (
      '<button type="button" class="detail-item' + (mastered ? " is-mastered" : "") + '" data-select="' + n.id + '">' +
      '<span class="di-no">' + escapeHTML(n.no || "") + "</span>" +
      '<span class="di-name">' + escapeHTML(n.name) + "</span>" +
      (count == null ? "" : '<span class="di-count">' + count + "</span>") +
      "</button>"
    );
  }

  function detailHTML(n) {
    const closeBtn = '<button type="button" class="detail-close" aria-label="关闭详情">×</button>';

    if (n.kind === "root") {
      const done = masteredInPoints(course.allPoints);
      return (
        '<div class="detail-head"><span class="detail-eyebrow">COURSE · 全课程</span>' + closeBtn + "</div>" +
        '<h3 class="detail-title">' + escapeHTML(course.name) + "</h3>" +
        '<p class="detail-path">' + escapeHTML(course.edition) + "</p>" +
        (course.intro ? '<p class="detail-quote">' + inline(course.intro) + "</p>" : "") +
        statsHTML([
          [course.chapterCount, "章"],
          [course.sectionCount, "节"],
          [course.pointCount, "考点"],
        ]) +
        '<div class="detail-list">' +
        '<div class="detail-list-label"><span>章节目录</span><span>已掌握 ' + done + " / " + course.pointCount + "</span></div>" +
        course.chapters
          .map((ch) => {
            const md = masteredInPoints(ch.sections.flatMap((s) => s.points));
            return (
              '<button type="button" class="detail-item' + (md === ch.pointCount && ch.pointCount ? " is-mastered" : "") + '" data-focus="' + ch.id + '">' +
              '<span class="di-no">' + escapeHTML(ch.no) + "</span>" +
              '<span class="di-name">' + escapeHTML(ch.name) + "</span>" +
              '<span class="di-count">' + ch.sections.length + " 节</span></button>"
            );
          })
          .join("") +
        "</div>" +
        '<div class="detail-actions">' +
        '<button type="button" class="master-btn" data-action="first-chapter">进入第一章</button>' +
        '<button type="button" class="ghost-btn" data-action="fit">全图适应</button>' +
        "</div>" +
        '<div class="detail-hint">点击左侧节点展开章节 · 拖拽空白处平移 · 滚轮以指针为中心缩放</div>'
      );
    }

    if (n.kind === "chapter") {
      const points = n.sections.flatMap((s) => s.points);
      const done = masteredInPoints(points);
      const pct = points.length ? Math.round((done / points.length) * 100) : 0;
      const allOpen = n.sections.length > 0 && n.sections.every((s) => state.expanded.has(s.id));
      const prev = course.chapters[n.index - 1] || null;
      const next = course.chapters[n.index + 1] || null;
      return (
        '<div class="detail-head"><span class="detail-eyebrow">CHAPTER · ' + escapeHTML(n.noLabel) + "</span>" + closeBtn + "</div>" +
        '<h3 class="detail-title">' + escapeHTML(n.name) + "</h3>" +
        '<p class="detail-path">' + escapeHTML(course.short) + " / " + escapeHTML(n.noLabel) + "</p>" +
        (n.intro ? '<p class="detail-quote">' + inline(n.intro) + "</p>" : "") +
        statsHTML([
          [n.sections.length, "节"],
          [n.pointCount, "考点"],
          [pct + "%", "已掌握"],
        ]) +
        '<div class="detail-list">' +
        '<div class="detail-list-label"><span>本章各节</span><span>共 ' + n.sections.length + " 节</span></div>" +
        n.sections.map((s) => itemHTML(s, s.points.length, masteredInPoints(s.points) === s.points.length && s.points.length > 0)).join("") +
        "</div>" +
        '<div class="detail-actions">' +
        (state.focus === n.id
          ? '<button type="button" class="master-btn" data-action="unfocus">退出聚焦</button>'
          : '<button type="button" class="master-btn" data-action="focus" data-ch="' + n.id + '">聚焦本章</button>') +
        '<button type="button" class="ghost-btn" data-action="' + (allOpen ? "collapse-chapter" : "expand-chapter") + '" data-ch="' + n.id + '">' +
        (allOpen ? "收起考点" : "展开全部考点") +
        "</button></div>" +
        navHTML(prev, next, "章") +
        '<div class="detail-hint">聚焦本章后，画布只保留这一章，适合逐节精读</div>'
      );
    }

    if (n.kind === "section") {
      const done = masteredInPoints(n.points);
      const prev = course.sections[course.sections.indexOf(n) - 1] || null;
      const next = course.sections[course.sections.indexOf(n) + 1] || null;
      const open = state.expanded.has(n.id);
      return (
        '<div class="detail-head"><span class="detail-eyebrow">SECTION · ' + escapeHTML(n.no) + "</span>" + closeBtn + "</div>" +
        '<h3 class="detail-title">' + escapeHTML(n.name) + "</h3>" +
        '<p class="detail-path">' + escapeHTML(course.short) + " / " + escapeHTML(n.chapter.noLabel) + "</p>" +
        '<p class="detail-quote">本节共 ' + n.points.length + " 个知识点，来自「" + escapeHTML(n.chapter.name) + "」。</p>" +
        statsHTML([
          [n.points.length, "考点"],
          [done, "已掌握"],
          [n.no, "节序号"],
        ]) +
        '<div class="detail-list">' +
        '<div class="detail-list-label"><span>本节知识点</span><span>' + done + " / " + n.points.length + "</span></div>" +
        n.points.map((p) => itemHTML(p, null, state.mastered.has(p.id))).join("") +
        "</div>" +
        '<div class="detail-actions">' +
        '<button type="button" class="master-btn" data-action="' + (open ? "collapse-section" : "expand-section") + '" data-sec="' + n.id + '">' +
        (open ? "收起知识点" : "展开知识点") +
        "</button>" +
        '<button type="button" class="ghost-btn" data-action="focus" data-ch="' + n.chapter.id + '">聚焦本章</button>' +
        "</div>" +
        navHTML(prev, next, "节") +
        '<div class="detail-hint">点击知识点查看凝练要点；按 M 可标记掌握</div>'
      );
    }

    // point
    const sec = n.section;
    const courseDone = masteredInPoints(course.allPoints);
    const pct = course.pointCount ? Math.round((courseDone / course.pointCount) * 100) : 0;
    const mastered = state.mastered.has(n.id);
    const prev = course.allPoints[n.seq - 1] || null;
    const next = course.allPoints[n.seq + 1] || null;
    const siblings = sec.points.filter((p) => p.id !== n.id).slice(0, 8);
    return (
      '<div class="detail-head"><span class="detail-eyebrow">POINT · ' + escapeHTML(n.no) + "</span>" + closeBtn + "</div>" +
      '<h3 class="detail-title">' + escapeHTML(n.name) + "</h3>" +
      '<p class="detail-path">' + escapeHTML(course.short) + " / " + escapeHTML(n.chapter.name) + " / " + escapeHTML(sec.name) + "</p>" +
      (n.desc ? '<p class="detail-quote">' + inline(n.desc) + "</p>" : "") +
      statsHTML([
        [n.index + 1 + "/" + sec.points.length, "本节序号"],
        [mastered ? "已掌握" : "未掌握", "掌握状态"],
        [pct + "%", "全课进度"],
      ]) +
      pointDetailHTML(n) +
      '<div class="detail-list">' +
      '<div class="detail-list-label"><span>同节知识点</span><span>' + sec.points.length + " 个</span></div>" +
      (siblings.length ? siblings.map((p) => itemHTML(p, null, state.mastered.has(p.id))).join("") : '<div class="detail-item"><span class="di-name">本节仅此一个知识点</span></div>') +
      "</div>" +
      '<div class="detail-actions">' +
      '<button type="button" class="master-btn' + (mastered ? " on" : "") + '" data-action="master">' +
      (mastered ? "✓ 已掌握 · 点击取消" : "标记为已掌握") +
      " <kbd>M</kbd></button>" +
      '<button type="button" class="ghost-btn" data-action="view-section" data-sec="' + sec.id + '">查看本节</button>' +
      "</div>" +
      navHTML(prev, next, "考点") +
      '<div class="detail-hint">快捷键：M 标记掌握 · ← / → 切换考点 · Esc 关闭面板</div>'
    );
  }

  function showDetail(n) {
    if (!n) return;
    state.detailOpen = true;
    detail.hidden = false;
    detail.innerHTML = detailHTML(n);
    detail.scrollTop = 0;
  }

  function refreshDetail() {
    if (!state.detailOpen || !state.selected) return;
    const n = course.byId.get(state.selected);
    if (n) showDetail(n);
  }

  function toggleMastered(id) {
    const n = course.byId.get(id);
    if (!n || n.kind !== "point") return;
    if (state.mastered.has(id)) state.mastered.delete(id);
    else state.mastered.add(id);
    writeJSON("gk-mastered-v1", Array.from(state.mastered));
    syncNodeClasses();
    renderSidebar();
    refreshDetail();
  }

  detail.addEventListener("click", (event) => {
    const close = event.target.closest(".detail-close");
    if (close) {
      closeDetail();
      return;
    }

    const focusTarget = event.target.closest("[data-focus]");
    if (focusTarget) {
      focusChapter(focusTarget.dataset.focus);
      return;
    }

    const selectTarget = event.target.closest("[data-select]");
    if (selectTarget) {
      selectNode(selectTarget.dataset.select, { center: true, reveal: true });
      return;
    }

    const navTarget = event.target.closest("[data-target]");
    if (navTarget && navTarget.dataset.target) {
      selectNode(navTarget.dataset.target, { center: true, reveal: true });
      return;
    }

    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) return;
    const action = actionEl.dataset.action;

    if (action === "master") {
      if (state.selected) toggleMastered(state.selected);
    } else if (action === "fit") {
      fitAll();
    } else if (action === "first-chapter") {
      if (course.chapters[0]) focusChapter(course.chapters[0].id);
    } else if (action === "focus") {
      focusChapter(actionEl.dataset.ch);
    } else if (action === "unfocus") {
      showOverview();
    } else if (action === "expand-chapter" || action === "collapse-chapter") {
      const ch = course.byId.get(actionEl.dataset.ch);
      if (!ch) return;
      state.focus = ch.id;
      state.expanded.add(ch.id);
      ch.sections.forEach((sec) => {
        if (action === "expand-chapter") state.expanded.add(sec.id);
        else state.expanded.delete(sec.id);
      });
      renderMap({ animate: true });
      renderSidebar();
      syncSeg();
      showDetail(ch);
      renderCrumbs();
      requestAnimationFrame(() => fitRegion(ch));
    } else if (action === "expand-section" || action === "collapse-section") {
      const sec = course.byId.get(actionEl.dataset.sec);
      if (!sec) return;
      if (action === "expand-section") state.expanded.add(sec.id);
      else state.expanded.delete(sec.id);
      renderMap({ animate: true });
      syncSeg();
      showDetail(sec);
      requestAnimationFrame(() => fitRegion(sec));
    } else if (action === "view-section") {
      const sec = course.byId.get(actionEl.dataset.sec);
      if (sec) selectNode(sec.id, { center: true, reveal: true });
    }
  });

  /* ---------------- 搜索 ---------------- */

  const TYPE_LABEL = { root: "课程", chapter: "章", section: "节", point: "点" };

  function pathFor(n) {
    if (n.kind === "root") return n.course.short;
    if (n.kind === "chapter") return n.course.short;
    if (n.kind === "section") return n.course.short + " · " + n.chapter.noLabel;
    return n.course.short + " · " + n.chapter.no + " 节";
  }

  function resetSearchUI() {
    state.query = "";
    searchInput.value = "";
    searchPanel.hidden = true;
    searchPanel.innerHTML = "";
    state.preSearch = null;
    state.searchMatchIds = new Set();
    state.searchAncestorIds = new Set();
    state.searchHasCurrent = false;
  }

  function clearSearch(restore) {
    const pre = state.preSearch;
    resetSearchUI();
    if (restore && pre) {
      state.expanded = new Set(pre.expanded);
      state.focus = pre.focus;
      state.selected = pre.selected;
      renderMap({ animate: true });
      renderSidebar();
      renderCrumbs();
      syncSeg();
      refreshDetail();
    } else {
      renderMap({ animate: false });
    }
  }

  function ancestorsOf(n) {
    const out = [];
    let p = n.parent;
    while (p && p.kind !== "root") {
      out.push(p.id);
      p = p.parent;
    }
    return out;
  }

  function performSearch(raw) {
    const q = String(raw || "").trim();
    if (!q) {
      if (state.query) clearSearch(true);
      return;
    }

    if (!state.preSearch) {
      state.preSearch = {
        expanded: new Set(state.expanded),
        focus: state.focus,
        selected: state.selected,
      };
    }

    state.query = q;
    const lower = q.toLowerCase();
    const matches = [];
    for (const n of searchNodes) {
      const name = (n.name || "").toLowerCase();
      if (name.includes(lower) || (n.no && String(n.no).includes(q))) {
        matches.push(n);
      } else if (n.kind === "point" && n.searchText && n.searchText.includes(lower)) {
        matches.push(n);
      }
      if (matches.length >= 80) break;
    }

    state.focus = null;
    state.expanded.clear();
    const current = matches.filter((n) => n.course === course);

    state.searchMatchIds = new Set(current.map((n) => n.id));
    const kin = new Set();
    current.forEach((n) => {
      state.searchMatchIds.add(n.id);
      if (n.kind === "root") kin.add(course.root.id);
      ancestorsOf(n).forEach((id) => kin.add(id));
    });
    // 当前课程内所有匹配的祖先都算“相关”，其中根节点也保留上下文
    kin.add(course.root.id);
    state.searchAncestorIds = kin;
    state.searchHasCurrent = current.length > 0;

    closeDetail();
    renderMap({ animate: false });
    renderSearchResults(matches, q);
    renderSidebar();
    renderCrumbs();
    syncSeg();
    fitAll(false);
  }

  function applySearchPaint() {
    nodeEls.forEach((el) => el.classList.remove("match", "kin", "dim"));
    if (!state.query || !state.searchHasCurrent) return;
    nodeEls.forEach((el, id) => {
      if (state.searchMatchIds.has(id)) el.classList.add("match");
      else if (state.searchAncestorIds.has(id)) el.classList.add("kin");
      else el.classList.add("dim");
    });
  }

  function renderSearchResults(matches, q) {
    if (!state.query) {
      searchPanel.hidden = true;
      return;
    }
    searchPanel.hidden = false;
    if (!matches.length) {
      searchPanel.innerHTML =
        '<div class="search-summary"><span>0 个结果</span><span>' + escapeHTML(q) + "</span></div>" +
        '<div class="search-empty">没有找到相关章节或知识点。<br>试试「极限」「矩阵」「熵」「晶体」。</div>';
      return;
    }
    const shown = matches.slice(0, 40);
    searchPanel.innerHTML =
      '<div class="search-summary"><span>' + matches.length + " 个结果</span><span>点击定位</span></div>" +
      shown
        .map(
          (n) =>
            '<button type="button" class="search-result" data-id="' + n.id + '">' +
            '<div class="sr-title"><span class="sr-type">' + TYPE_LABEL[n.kind] + "</span><span>" + escapeHTML(truncate(n.name, 26)) + "</span></div>" +
            '<div class="sr-path">' + escapeHTML(pathFor(n)) + "</div></button>"
        )
        .join("");
  }

  function goToNode(n) {
    if (!n) return;
    resetSearchUI();
    if (n.course !== course) {
      switchCourse(n.course.ci, { fit: false });
    }
    if (n.kind === "root") {
      showOverview();
      selectNode(n.id, { center: true });
      searchInput.blur();
      return;
    }

    state.focus = n.kind === "chapter" ? n.id : n.chapter.id;
    state.expanded = new Set([state.focus]);
    if (n.kind === "point") state.expanded.add(n.section.id);
    state.selected = n.id;
    renderMap({ animate: false });
    state.detailOpen = true;
    showDetail(n);
    renderSidebar();
    renderCrumbs();
    syncSeg();
    requestAnimationFrame(() => {
      if (n.kind === "point") fitRegion(n.section, false);
      else fitRegion(n.kind === "chapter" ? n : n.chapter, false);
    });
    searchInput.blur();
  }

  searchPanel.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-id]");
    if (btn) goToNode(globalById.get(btn.dataset.id));
  });

  let searchTimer = 0;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const value = searchInput.value;
    searchTimer = window.setTimeout(() => performSearch(value), 130);
  });

  /* ---------------- 视图交互 ---------------- */

  let panState = null;

  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest(".node, .detail, .search-panel, .zoom-pill, .legend, .hint")) return;
    if (document.body.classList.contains("sidebar-open")) document.body.classList.remove("sidebar-open");
    panState = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      px: state.panX,
      py: state.panY,
      moved: false,
    };
    cancelAnimationFrame(viewRaf);
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("panning");
    hint.classList.add("gone");
  });

  viewport.addEventListener("pointermove", (event) => {
    if (!panState || panState.id !== event.pointerId) return;
    const dx = event.clientX - panState.x;
    const dy = event.clientY - panState.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) panState.moved = true;
    state.panX = panState.px + dx;
    state.panY = panState.py + dy;
    applyWorld();
  });

  function endPan(event) {
    if (!panState || panState.id !== event.pointerId) return;
    const moved = panState.moved;
    panState = null;
    viewport.classList.remove("panning");
    try {
      viewport.releasePointerCapture(event.pointerId);
    } catch (err) {
      /* ignore */
    }
    if (!moved) closeDetail();
  }

  viewport.addEventListener("pointerup", endPan);
  viewport.addEventListener("pointercancel", endPan);

  viewport.addEventListener(
    "wheel",
    (event) => {
      if (event.target.closest(".detail, .search-panel")) return;
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      const factor = Math.exp(-event.deltaY * 0.0016);
      zoomAt(factor, mx, my);
      hint.classList.add("gone");
    },
    { passive: false }
  );

  /* ---------------- 控件绑定 ---------------- */

  tabsEl.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-ci]");
    if (tab) switchCourse(Number(tab.dataset.ci));
  });

  allChaptersBtn.addEventListener("click", showOverview);

  chapterList.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-ch]");
    if (btn) focusChapter(btn.dataset.ch);
  });

  levelSeg.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-level]");
    if (btn) setLevel(Number(btn.dataset.level));
  });

  crumbsEl.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-crumb]");
    if (btn) selectNode(btn.dataset.crumb, { center: true, reveal: true });
  });

  fitBtn.addEventListener("click", () => fitAll());
  zoomFit.addEventListener("click", () => fitAll());
  zoomOut.addEventListener("click", () => {
    const rect = viewport.getBoundingClientRect();
    zoomAt(1 / 1.2, rect.width / 2, rect.height / 2);
  });
  zoomIn.addEventListener("click", () => {
    const rect = viewport.getBoundingClientRect();
    zoomAt(1.2, rect.width / 2, rect.height / 2);
  });

  themeBtn.addEventListener("click", () => {
    setTheme(state.theme === "dark" ? "light" : "dark");
  });

  menuBtn.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-open");
  });

  /* ---------------- 课程切换 ---------------- */

  function switchCourse(ci, options) {
    if (ci < 0 || ci >= courses.length) return;
    const opts = options || {};
    if (ci === state.ci && !opts.force) {
      if (opts.fit !== false) fitAll();
      return;
    }

    state.ci = ci;
    course = courses[ci];
    try {
      localStorage.setItem("gk-ci", String(ci));
    } catch (err) {
      /* ignore */
    }

    resetSearchUI();
    state.focus = null;
    state.selected = null;
    state.expanded.clear();
    state.scale = 1;
    state.panX = 0;
    state.panY = 0;
    state.detailOpen = false;
    detail.hidden = true;
    detail.innerHTML = "";

    nodeEls.forEach((el) => el.remove());
    nodeEls.clear();
    linkEls.forEach((el) => el.remove());
    linkEls.clear();
    cancelAnimationFrame(layoutRaf);

    document.documentElement.style.setProperty("--accent", accentFor(course.color));
    renderTabs();
    renderCourseHead();
    renderSidebar();
    renderCrumbs();
    syncSeg();
    applyWorld();
    renderMap({ animate: false });
    if (opts.fit !== false) requestAnimationFrame(() => fitAll(false));
  }

  /* ---------------- 键盘快捷键 ---------------- */

  document.addEventListener("keydown", (event) => {
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      searchInput.focus();
      searchInput.select();
      return;
    }

    if (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      searchInput.focus();
      searchInput.select();
      return;
    }

    if (event.key === "Escape") {
      if (state.query) {
        clearSearch(true);
        searchInput.blur();
      } else if (state.detailOpen) {
        closeDetail();
      } else if (document.body.classList.contains("sidebar-open")) {
        document.body.classList.remove("sidebar-open");
      }
      return;
    }

    if (typing) return;

    if (event.key === "m" || event.key === "M") {
      if (state.selected) {
        const n = course.byId.get(state.selected);
        if (n && n.kind === "point") {
          event.preventDefault();
          toggleMastered(n.id);
        }
      }
      return;
    }

    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      zoomAt(1.2, rect.width / 2, rect.height / 2);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      zoomAt(1 / 1.2, rect.width / 2, rect.height / 2);
    } else if (event.key === "0") {
      event.preventDefault();
      fitAll();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      if (!state.selected || !state.detailOpen) return;
      const n = course.byId.get(state.selected);
      if (!n || n.kind !== "point") return;
      event.preventDefault();
      const target = event.key === "ArrowLeft" ? course.allPoints[n.seq - 1] : course.allPoints[n.seq + 1];
      if (target) selectNode(target.id, { center: true, reveal: true });
    }
  });

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(viewRaf);
    applyWorld();
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const n = state.selected ? course.byId.get(state.selected) : null;
      if (state.focus) {
        const ch = course.byId.get(state.focus);
        if (ch) fitRegion(ch, false);
        if (n && n.kind === "point") requestAnimationFrame(() => ensureNodeVisible(n));
      } else if (n) {
        ensureNodeVisible(n);
      } else {
        fitAll(false);
      }
    }, 140);
  });

  /* ---------------- 启动 ---------------- */

  setTheme(readJSON("gk-theme", "light"), false);
  document.documentElement.style.setProperty("--accent", accentFor(course.color));
  renderTabs();
  renderCourseHead();
  renderSidebar();
  renderCrumbs();
  syncSeg();
  renderMap({ animate: false });
  applyWorld();
  requestAnimationFrame(() => fitAll(false));
  window.setTimeout(() => hint.classList.add("gone"), 10000);
})();
