/* ======================================================================
 * 議事録作成アプリ
 *  - 入力フォーム → ライブプレビュー
 *  - localStorage に複数の議事録を保存／読込／削除
 *  - 印刷機能で PDF 出力（日本語フォントはブラウザ任せで文字化けしない）
 *  - JSON でバックアップ／復元
 * ==================================================================== */
(function () {
  "use strict";

  const STORAGE_KEY = "giziroku.records.v1";

  /* ------------------------------------------------------------------ *
   * ユーティリティ
   * ------------------------------------------------------------------ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function uid() {
    return "m_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-show"), 2200);
  }

  /* ------------------------------------------------------------------ *
   * 永続化レイヤー
   * ------------------------------------------------------------------ */
  function loadRecords() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error("読込失敗", e);
      return [];
    }
  }

  function saveRecords(records) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  /* ------------------------------------------------------------------ *
   * アプリ状態
   * ------------------------------------------------------------------ */
  let records = loadRecords();
  let currentId = null; // 現在編集中のレコードID（未保存なら null）

  /* ------------------------------------------------------------------ *
   * 動的行（議題・アクションアイテム）
   * ------------------------------------------------------------------ */
  function addAgenda(data = { topic: "", body: "" }) {
    const list = $("#agenda-list");
    const idx = list.children.length + 1;
    const wrap = document.createElement("div");
    wrap.className = "agenda-item";
    wrap.innerHTML = `
      <div class="agenda-item__head">
        <span class="agenda-item__num"></span>
        <input type="text" class="js-agenda-topic" placeholder="議題のタイトル" />
        <button type="button" class="btn--icon js-remove" title="削除">✕</button>
      </div>
      <textarea rows="3" class="js-agenda-body" placeholder="議論の内容・要点"></textarea>
    `;
    $(".js-agenda-topic", wrap).value = data.topic || "";
    $(".js-agenda-body", wrap).value = data.body || "";
    $(".js-remove", wrap).addEventListener("click", () => {
      wrap.remove();
      renumberAgenda();
      onChange();
    });
    wrap.addEventListener("input", onChange);
    list.appendChild(wrap);
    renumberAgenda();
  }

  function renumberAgenda() {
    $$("#agenda-list .agenda-item__num").forEach((el, i) => (el.textContent = i + 1));
  }

  function addAction(data = { task: "", owner: "", due: "" }) {
    const list = $("#action-list");
    const row = document.createElement("div");
    row.className = "action-row";
    row.innerHTML = `
      <input type="text" class="js-task" placeholder="やること" />
      <input type="text" class="js-owner" placeholder="担当者" />
      <input type="text" class="js-due" placeholder="期限" />
      <button type="button" class="btn--icon js-remove" title="削除">✕</button>
    `;
    $(".js-task", row).value = data.task || "";
    $(".js-owner", row).value = data.owner || "";
    $(".js-due", row).value = data.due || "";
    $(".js-remove", row).addEventListener("click", () => {
      row.remove();
      onChange();
    });
    row.addEventListener("input", onChange);
    list.appendChild(row);
  }

  /* ------------------------------------------------------------------ *
   * フォーム ⇄ データ
   * ------------------------------------------------------------------ */
  function collectForm() {
    const agendas = $$("#agenda-list .agenda-item").map((el) => ({
      topic: $(".js-agenda-topic", el).value.trim(),
      body: $(".js-agenda-body", el).value.trim(),
    }));
    const actions = $$("#action-list .action-row").map((el) => ({
      task: $(".js-task", el).value.trim(),
      owner: $(".js-owner", el).value.trim(),
      due: $(".js-due", el).value.trim(),
    }));
    return {
      title: $("#title").value.trim(),
      date: $("#date").value,
      startTime: $("#startTime").value,
      endTime: $("#endTime").value,
      location: $("#location").value.trim(),
      author: $("#author").value.trim(),
      attendees: $("#attendees").value.trim(),
      absentees: $("#absentees").value.trim(),
      agendas,
      decisions: $("#decisions").value,
      actions,
      nextMeeting: $("#nextMeeting").value.trim(),
      notes: $("#notes").value,
    };
  }

  function fillForm(d) {
    d = d || {};
    $("#title").value = d.title || "";
    $("#date").value = d.date || "";
    $("#startTime").value = d.startTime || "";
    $("#endTime").value = d.endTime || "";
    $("#location").value = d.location || "";
    $("#author").value = d.author || "";
    $("#attendees").value = d.attendees || "";
    $("#absentees").value = d.absentees || "";
    $("#decisions").value = d.decisions || "";
    $("#nextMeeting").value = d.nextMeeting || "";
    $("#notes").value = d.notes || "";

    $("#agenda-list").innerHTML = "";
    const agendas = (d.agendas && d.agendas.length) ? d.agendas : [{ topic: "", body: "" }];
    agendas.forEach(addAgenda);

    $("#action-list").innerHTML = "";
    (d.actions || []).forEach(addAction);
  }

  /* ------------------------------------------------------------------ *
   * プレビュー描画
   * ------------------------------------------------------------------ */
  function formatDateLine(d) {
    const parts = [];
    if (d.date) {
      const dt = new Date(d.date + "T00:00:00");
      if (!isNaN(dt)) {
        const w = "日月火水木金土"[dt.getDay()];
        parts.push(`${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日（${w}）`);
      } else {
        parts.push(d.date);
      }
    }
    if (d.startTime || d.endTime) {
      parts.push(`${d.startTime || ""}${d.endTime ? " 〜 " + d.endTime : ""}`);
    }
    return parts.join("　");
  }

  function linesToList(text) {
    const items = String(text || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!items.length) return `<p class="doc__empty">（なし）</p>`;
    return `<ul class="doc__list">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
  }

  function buildDocHtml(d) {
    const dateLine = formatDateLine(d);
    const metaRows = [];
    if (dateLine) metaRows.push(["日時", escapeHtml(dateLine)]);
    if (d.location) metaRows.push(["場所", escapeHtml(d.location)]);
    if (d.attendees) metaRows.push(["出席者", escapeHtml(d.attendees)]);
    if (d.absentees) metaRows.push(["欠席者", escapeHtml(d.absentees)]);
    if (d.author) metaRows.push(["作成者", escapeHtml(d.author)]);

    const metaHtml = metaRows.length
      ? `<table class="doc__meta"><tbody>${metaRows
          .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
          .join("")}</tbody></table>`
      : "";

    const agendaItems = (d.agendas || []).filter((a) => a.topic || a.body);
    const agendaHtml = agendaItems.length
      ? agendaItems
          .map(
            (a, i) => `
        <div class="doc__agenda">
          <p class="doc__agenda-title">${i + 1}. ${escapeHtml(a.topic) || "（無題）"}</p>
          ${a.body ? `<p class="doc__agenda-body">${escapeHtml(a.body)}</p>` : ""}
        </div>`
          )
          .join("")
      : `<p class="doc__empty">（なし）</p>`;

    const actions = (d.actions || []).filter((a) => a.task || a.owner || a.due);
    const actionHtml = actions.length
      ? `<table class="doc__table"><thead><tr><th>内容</th><th style="width:110px">担当者</th><th style="width:120px">期限</th></tr></thead>
         <tbody>${actions
           .map(
             (a) =>
               `<tr><td>${escapeHtml(a.task)}</td><td>${escapeHtml(a.owner)}</td><td>${escapeHtml(a.due)}</td></tr>`
           )
           .join("")}</tbody></table>`
      : `<p class="doc__empty">（なし）</p>`;

    const now = new Date();
    const stamp = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(
      now.getDate()
    ).padStart(2, "0")}`;

    return `
      <div class="doc">
        <h1 class="doc__title">${escapeHtml(d.title) || "（会議名未入力）"}</h1>
        <p class="doc__subtitle">議事録</p>
        ${metaHtml}

        <h2 class="doc__h">議題・議事内容</h2>
        ${agendaHtml}

        <h2 class="doc__h">決定事項</h2>
        ${linesToList(d.decisions)}

        <h2 class="doc__h">アクションアイテム（ToDo）</h2>
        ${actionHtml}

        ${
          d.nextMeeting
            ? `<h2 class="doc__h">次回会議</h2><p class="doc__notes">${escapeHtml(d.nextMeeting)}</p>`
            : ""
        }
        ${
          d.notes && d.notes.trim()
            ? `<h2 class="doc__h">備考</h2><p class="doc__notes">${escapeHtml(d.notes)}</p>`
            : ""
        }

        <div class="doc__footer">作成日: ${stamp}</div>
      </div>
    `;
  }

  function renderPreview() {
    const html = buildDocHtml(collectForm());
    $("#preview").innerHTML = html;
  }

  /* ------------------------------------------------------------------ *
   * 保存済み一覧
   * ------------------------------------------------------------------ */
  function renderSavedList() {
    const ul = $("#saved-list");
    ul.innerHTML = "";
    if (!records.length) {
      ul.innerHTML = `<li class="saved-list__empty">まだ保存された議事録はありません。</li>`;
      return;
    }
    const sorted = [...records].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    sorted.forEach((rec) => {
      const li = document.createElement("li");
      li.className = "saved-list__item" + (rec.id === currentId ? " is-active" : "");
      const updated = rec.updatedAt ? new Date(rec.updatedAt) : null;
      const dateStr = updated
        ? `${updated.getFullYear()}/${updated.getMonth() + 1}/${updated.getDate()}`
        : "";
      li.innerHTML = `
        <div class="saved-list__main">
          <div class="saved-list__title">${escapeHtml(rec.data.title) || "（無題）"}</div>
          <div class="saved-list__date">更新: ${dateStr}</div>
        </div>
        <button type="button" class="btn--icon js-del" title="削除">🗑</button>
      `;
      li.addEventListener("click", (e) => {
        if (e.target.closest(".js-del")) return;
        openRecord(rec.id);
      });
      $(".js-del", li).addEventListener("click", (e) => {
        e.stopPropagation();
        deleteRecord(rec.id);
      });
      ul.appendChild(li);
    });
  }

  function openRecord(id) {
    const rec = records.find((r) => r.id === id);
    if (!rec) return;
    currentId = id;
    fillForm(rec.data);
    renderPreview();
    renderSavedList();
    toast("読み込みました");
  }

  function deleteRecord(id) {
    const rec = records.find((r) => r.id === id);
    if (!rec) return;
    if (!confirm(`「${rec.data.title || "（無題）"}」を削除しますか？`)) return;
    records = records.filter((r) => r.id !== id);
    saveRecords(records);
    if (currentId === id) {
      currentId = null;
      fillForm({});
      renderPreview();
    }
    renderSavedList();
    toast("削除しました");
  }

  /* ------------------------------------------------------------------ *
   * アクション（保存・新規・PDF・JSON）
   * ------------------------------------------------------------------ */
  function saveCurrent() {
    const data = collectForm();
    if (!data.title) {
      toast("会議名を入力してください");
      $("#title").focus();
      return;
    }
    const now = Date.now();
    if (currentId) {
      const rec = records.find((r) => r.id === currentId);
      if (rec) {
        rec.data = data;
        rec.updatedAt = now;
      }
    } else {
      currentId = uid();
      records.push({ id: currentId, data, createdAt: now, updatedAt: now });
    }
    saveRecords(records);
    renderSavedList();
    toast("保存しました");
  }

  function newRecord() {
    if (confirm("新しい議事録を作成します。入力中の内容は保存していなければ失われます。よろしいですか？")) {
      currentId = null;
      fillForm({});
      renderPreview();
      renderSavedList();
      $("#title").focus();
    }
  }

  function exportPdf() {
    // 印刷専用領域に最新の内容を流し込んでから印刷ダイアログを開く
    $("#print-area").innerHTML = buildDocHtml(collectForm());
    setTimeout(() => window.print(), 50);
  }

  function exportJson() {
    if (!records.length) {
      toast("保存済みの議事録がありません");
      return;
    }
    const blob = new Blob([JSON.stringify(records, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `giziroku_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("バックアップを書き出しました");
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const incoming = JSON.parse(reader.result);
        if (!Array.isArray(incoming)) throw new Error("形式が不正です");
        const map = new Map(records.map((r) => [r.id, r]));
        incoming.forEach((r) => {
          if (r && r.id && r.data) map.set(r.id, r);
        });
        records = Array.from(map.values());
        saveRecords(records);
        renderSavedList();
        toast(`${incoming.length}件を読み込みました`);
      } catch (e) {
        toast("読み込みに失敗しました（JSON形式を確認してください）");
      }
    };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------------ *
   * 変更ハンドリング（プレビュー更新）
   * ------------------------------------------------------------------ */
  let renderTimer = null;
  function onChange() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderPreview, 120);
  }

  /* ------------------------------------------------------------------ *
   * 初期化
   * ------------------------------------------------------------------ */
  function init() {
    fillForm({});
    renderPreview();
    renderSavedList();

    $("#minutes-form").addEventListener("input", onChange);
    $("#btn-add-agenda").addEventListener("click", () => {
      addAgenda();
      onChange();
    });
    $("#btn-add-action").addEventListener("click", () => {
      addAction();
      onChange();
    });
    $("#btn-save").addEventListener("click", saveCurrent);
    $("#btn-new").addEventListener("click", newRecord);
    $("#btn-pdf").addEventListener("click", exportPdf);
    $("#btn-export").addEventListener("click", exportJson);
    $("#import-file").addEventListener("change", (e) => {
      if (e.target.files[0]) importJson(e.target.files[0]);
      e.target.value = "";
    });

    // Ctrl/Cmd + S で保存
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveCurrent();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
