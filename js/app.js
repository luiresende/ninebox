// ============================================================================
// APP: orquestra UI, estado e gráficos
// ============================================================================

(function () {
  const { PILLARS, SCALE_MIN, SCALE_MAX } = Model;

  // Estado em memória
  let members = [];
  let selectedId = null;
  let editingId = null; // null = criando; id = editando no modal
  const radarCharts = {}; // pillarId -> Chart
  let nineBoxChart = null;

  // --------------------------- Util DOM ------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function initials(name) {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || '')
      .join('');
  }

  function fmt(n) {
    return Number.isFinite(n) ? n.toFixed(2) : '—';
  }

  // --------------------------- Navegação -----------------------------------
  function switchView(view) {
    $$('.nav-item').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    if (view === 'ninebox') renderNineBox();
    if (view === 'evaluate') renderEvaluate();
  }

  $$('.nav-item').forEach((tab) => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });

  // --------------------------- Store badge ---------------------------------
  function updateStorageBadge() {
    const badge = $('#storage-badge');
    if (Store.mode === 'firebase') {
      badge.textContent = 'Firebase';
      badge.className = 'badge badge-cloud';
    } else {
      badge.textContent = 'Modo Local';
      badge.className = 'badge badge-local';
    }
  }

  // --------------------------- View: Time ----------------------------------
  function renderTeam() {
    const list = $('#member-list');
    const empty = $('#empty-team');
    list.innerHTML = '';

    if (members.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    members.forEach((m) => {
      const card = document.createElement('div');
      card.className = 'member-card';
      card.innerHTML = `
        <div class="avatar">${initials(m.name)}</div>
        <div class="m-name">${escapeHtml(m.name)}</div>
        <div class="m-role">${escapeHtml(m.role || '—')}</div>
        <span class="m-box">${Model.nineBoxLabel(m)}</span>
      `;
      card.addEventListener('click', () => openMemberModal(m.id));
      list.appendChild(card);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  // --------------------------- Modal ---------------------------------------
  function openMemberModal(id) {
    editingId = id || null;
    const member = id ? members.find((m) => m.id === id) : null;
    $('#modal-title').textContent = member ? 'Editar colaborador' : 'Novo colaborador';
    $('#input-name').value = member ? member.name : '';
    $('#input-role').value = member ? member.role || '' : '';
    $('#btn-delete-member').classList.toggle('hidden', !member);
    $('#member-modal').classList.remove('hidden');
    $('#input-name').focus();
  }

  function closeMemberModal() {
    $('#member-modal').classList.add('hidden');
    editingId = null;
  }

  $('#btn-add-member').addEventListener('click', () => openMemberModal(null));
  $('#btn-cancel-member').addEventListener('click', closeMemberModal);

  $('#btn-save-member').addEventListener('click', async () => {
    const name = $('#input-name').value.trim();
    if (!name) {
      $('#input-name').focus();
      return;
    }
    const role = $('#input-role').value.trim();

    if (editingId) {
      const m = members.find((x) => x.id === editingId);
      m.name = name;
      m.role = role;
      await Store.save(m);
    } else {
      const m = { id: Store.newId(), name, role, scores: {} };
      await Store.save(m);
      members.push(m);
    }
    closeMemberModal();
    await reloadAndRender();
  });

  $('#btn-delete-member').addEventListener('click', async () => {
    if (!editingId) return;
    if (!confirm('Excluir este colaborador? Esta ação não pode ser desfeita.')) return;
    await Store.remove(editingId);
    if (selectedId === editingId) selectedId = null;
    closeMemberModal();
    await reloadAndRender();
  });

  // --------------------------- View: Avaliação -----------------------------
  function populateMemberSelect() {
    const sel = $('#member-select');
    sel.innerHTML = '';
    if (members.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = 'Nenhum colaborador';
      opt.value = '';
      sel.appendChild(opt);
      return;
    }
    members.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      sel.appendChild(opt);
    });
    if (!selectedId || !members.find((m) => m.id === selectedId)) {
      selectedId = members[0].id;
    }
    sel.value = selectedId;
  }

  $('#member-select').addEventListener('change', (e) => {
    selectedId = e.target.value;
    renderEvaluate();
  });

  function renderEvaluate() {
    populateMemberSelect();
    const member = members.find((m) => m.id === selectedId);
    const empty = $('#evaluate-empty');
    const body = $('#evaluate-body');

    if (!member) {
      empty.classList.remove('hidden');
      body.classList.add('hidden');
      return;
    }
    empty.classList.add('hidden');
    body.classList.remove('hidden');

    // Scoreboard
    $('#score-performance').textContent = fmt(Model.performanceScore(member));
    $('#score-potential').textContent = fmt(Model.potentialScore(member));
    $('#score-ninebox').textContent = Model.nineBoxLabel(member);

    // Pilares
    const container = $('.pillars');
    container.innerHTML = '';
    PILLARS.forEach((pillar) => {
      container.appendChild(buildPillarCard(member, pillar));
    });
    // Desenha os radares depois que os canvases estão no DOM
    PILLARS.forEach((pillar) => drawRadar(member, pillar));
  }

  function buildPillarCard(member, pillar) {
    const card = document.createElement('div');
    card.className = 'pillar-card';

    const avg = Model.pillarAverage(member, pillar);
    const head = document.createElement('div');
    head.className = 'pillar-head';
    head.innerHTML = `
      <span class="p-avg" style="color:${pillar.color}">${fmt(avg)}</span>
      <div class="p-name">${pillar.name}</div>
      <div class="p-sub">${pillar.subtitle}</div>
    `;
    card.appendChild(head);

    const radarWrap = document.createElement('div');
    radarWrap.className = 'radar-wrap';
    const canvas = document.createElement('canvas');
    canvas.id = 'radar-' + pillar.id;
    radarWrap.appendChild(canvas);
    card.appendChild(radarWrap);

    // Linhas de competência com botões de nota 1..5
    pillar.competencies.forEach((comp) => {
      const row = document.createElement('div');
      row.className = 'comp-row';
      const current = member.scores?.[pillar.id]?.[comp.name];

      // nome + descrição logo abaixo
      const info = document.createElement('div');
      info.className = 'comp-info';
      const nameEl = document.createElement('div');
      nameEl.className = 'comp-name';
      nameEl.textContent = comp.name;
      const descEl = document.createElement('div');
      descEl.className = 'comp-desc';
      descEl.textContent = comp.desc;
      info.appendChild(nameEl);
      info.appendChild(descEl);

      const controls = document.createElement('div');
      controls.className = 'comp-controls';
      for (let v = SCALE_MIN; v <= SCALE_MAX; v++) {
        const dot = document.createElement('button');
        dot.className = 'dot' + (current === v ? ' active' : '');
        dot.textContent = v;
        dot.addEventListener('click', () => setScore(member, pillar, comp.name, v));
        controls.appendChild(dot);
      }

      row.appendChild(info);
      row.appendChild(controls);
      card.appendChild(row);
    });

    return card;
  }

  async function setScore(member, pillar, comp, value) {
    member.scores = member.scores || {};
    member.scores[pillar.id] = member.scores[pillar.id] || {};
    // clicar na nota já ativa alterna para "sem nota"
    if (member.scores[pillar.id][comp] === value) {
      delete member.scores[pillar.id][comp];
    } else {
      member.scores[pillar.id][comp] = value;
    }
    await Store.save(member);
    renderEvaluate(); // re-render para atualizar dots, médias, radar e scoreboard
  }

  // --------------------------- Radares -------------------------------------
  function drawRadar(member, pillar) {
    const canvas = document.getElementById('radar-' + pillar.id);
    if (!canvas) return;

    // destrói instância anterior para evitar vazamento/sobreposição
    if (radarCharts[pillar.id]) {
      radarCharts[pillar.id].destroy();
    }

    const labels = Model.compNames(pillar);
    const memberData = Model.memberScoresByCompetency(member, pillar);
    const teamData = Model.teamAverageByCompetency(members, pillar, member.id);

    radarCharts[pillar.id] = new Chart(canvas, {
      type: 'radar',
      data: {
        labels,
        datasets: [
          {
            // marca d'água: média do restante do time, em cinza claro
            label: 'Média do time',
            data: teamData,
            backgroundColor: 'rgba(148, 163, 184, 0.15)',
            borderColor: 'rgba(148, 163, 184, 0.55)',
            borderWidth: 1,
            borderDash: [4, 4],
            pointRadius: 2,
            pointBackgroundColor: 'rgba(148, 163, 184, 0.6)',
          },
          {
            label: member.name,
            data: memberData,
            backgroundColor: hexToRgba(pillar.color, 0.25),
            borderColor: pillar.color,
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: pillar.color,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#94a3b8', boxWidth: 12, font: { size: 11 } },
          },
        },
        scales: {
          r: {
            min: 0,
            max: SCALE_MAX,
            ticks: { stepSize: 1, color: '#64748b', backdropColor: 'transparent' },
            grid: { color: 'rgba(148,163,184,0.2)' },
            angleLines: { color: 'rgba(148,163,184,0.2)' },
            pointLabels: { color: '#cbd5e1', font: { size: 11 } },
          },
        },
      },
    });
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // --------------------------- Nine Box ------------------------------------
  function renderNineBox() {
    const canvas = $('#ninebox-chart');
    if (nineBoxChart) nineBoxChart.destroy();

    const points = members.map((m) => ({
      x: Model.performanceScore(m),
      y: Model.potentialScore(m),
      label: m.name,
      box: Model.nineBoxLabel(m),
    }));

    // plugin para desenhar as 9 células de fundo + rótulos
    const gridPlugin = {
      id: 'nineGrid',
      beforeDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        if (!chartArea) return;
        const { left, right, top, bottom } = chartArea;
        const xThirds = [SCALE_MIN + (SCALE_MAX - SCALE_MIN) / 3, SCALE_MIN + (2 * (SCALE_MAX - SCALE_MIN)) / 3];
        const yThirds = xThirds;

        const colors = [
          ['#7f1d1d', '#78350f', '#1e3a8a'],
          ['#78350f', '#1e3a8a', '#065f46'],
          ['#1e3a8a', '#065f46', '#064e3b'],
        ];
        const labels = [
          ['Risco', 'Eficaz', 'Especialista'],
          ['Dilema', 'Mantenedor', 'Forte desemp.'],
          ['Enigma', 'Crescimento', 'Estrela'],
        ];

        const xs = [SCALE_MIN, ...xThirds, SCALE_MAX];
        const ys = [SCALE_MIN, ...yThirds, SCALE_MAX];

        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 3; col++) {
            const x0 = scales.x.getPixelForValue(xs[col]);
            const x1 = scales.x.getPixelForValue(xs[col + 1]);
            const y0 = scales.y.getPixelForValue(ys[row + 1]);
            const y1 = scales.y.getPixelForValue(ys[row]);
            ctx.save();
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = colors[row][col];
            ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
            ctx.restore();
            // rótulo
            ctx.save();
            ctx.globalAlpha = 0.75;
            ctx.fillStyle = '#e2e8f0';
            ctx.font = '12px Segoe UI, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(labels[row][col], (x0 + x1) / 2, (y0 + y1) / 2);
            ctx.restore();
          }
        }
      },
    };

    nineBoxChart = new Chart(canvas, {
      type: 'scatter',
      data: {
        datasets: [
          {
            label: 'Colaboradores',
            data: points,
            backgroundColor: '#60a5fa',
            borderColor: '#1e3a8a',
            borderWidth: 2,
            pointRadius: 7,
            pointHoverRadius: 9,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const p = ctx.raw;
                return `${p.label} — ${p.box} (Desemp. ${p.x.toFixed(2)} / Pot. ${p.y.toFixed(2)})`;
              },
            },
          },
        },
        scales: {
          x: {
            min: SCALE_MIN,
            max: SCALE_MAX,
            title: { display: true, text: 'Desempenho →', color: '#94a3b8' },
            ticks: { color: '#64748b' },
            grid: { color: 'rgba(148,163,184,0.15)' },
          },
          y: {
            min: SCALE_MIN,
            max: SCALE_MAX,
            title: { display: true, text: 'Potencial →', color: '#94a3b8' },
            ticks: { color: '#64748b' },
            grid: { color: 'rgba(148,163,184,0.15)' },
          },
        },
      },
      plugins: [gridPlugin],
    });

    // legenda com os nomes e suas posições
    const legend = $('#ninebox-legend');
    legend.innerHTML = '';
    members.forEach((m) => {
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.innerHTML = `<span class="lg-dot" style="background:#60a5fa"></span> ${escapeHtml(
        m.name
      )} — <strong style="color:#cbd5e1">${Model.nineBoxLabel(m)}</strong>`;
      legend.appendChild(item);
    });

    renderNineBoxGuide();
  }

  // Explicação de cada um dos 9 quadrantes, no mesmo layout da matriz:
  // potencial ALTO em cima, desempenho crescendo da esquerda para a direita.
  function renderNineBoxGuide() {
    const guide = $('#ninebox-guide');
    if (!guide) return;
    guide.innerHTML = '';

    // cores de fundo iguais às células do gráfico
    const colors = [
      ['#7f1d1d', '#78350f', '#1e3a8a'], // potencial baixo
      ['#78350f', '#1e3a8a', '#065f46'], // potencial médio
      ['#1e3a8a', '#065f46', '#064e3b'], // potencial alto
    ];

    // conta quantos colaboradores caem em cada quadrante
    const counts = {};
    members.forEach((m) => {
      const label = Model.nineBoxLabel(m);
      counts[label] = (counts[label] || 0) + 1;
    });

    // itera de potencial ALTO (linha 2) para BAIXO (linha 0) p/ bater com o eixo Y
    for (let p = 2; p >= 0; p--) {
      for (let d = 0; d < 3; d++) {
        const cell = Model.NINE_BOX[p][d];
        const n = counts[cell.name] || 0;
        const card = document.createElement('div');
        card.className = 'quadrant-card';
        card.style.borderTopColor = colors[p][d];
        card.innerHTML = `
          <div class="q-head">
            <span class="q-name">${escapeHtml(cell.name)}</span>
            <span class="q-count" title="Colaboradores neste quadrante">${n}</span>
          </div>
          <div class="q-axes">Potencial ${potLabel(p)} · Desempenho ${perfLabel(d)}</div>
          <div class="q-desc">${escapeHtml(cell.desc)}</div>
        `;
        guide.appendChild(card);
      }
    }
  }

  function potLabel(i) {
    return ['baixo', 'médio', 'alto'][i];
  }
  function perfLabel(i) {
    return ['baixo', 'médio', 'alto'][i];
  }

  // --------------------------- Ciclo de vida -------------------------------
  async function reloadAndRender() {
    members = await Store.list();
    renderTeam();
    renderEvaluate();
    const activeView = $('.nav-item.active')?.dataset.view;
    if (activeView === 'ninebox') renderNineBox();
  }

  // fecha o modal ao clicar fora
  $('#member-modal').addEventListener('click', (e) => {
    if (e.target.id === 'member-modal') closeMemberModal();
  });

  async function init() {
    updateStorageBadge();
    await reloadAndRender();
  }

  init();
})();
