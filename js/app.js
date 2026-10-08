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

  // Papel do usuário logado. Líder edita; colaborador só visualiza o próprio.
  function canEdit() {
    return Store.isLeader();
  }

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
    // colaborador não acessa a aba de usuários
    if (view === 'users' && !canEdit()) view = 'team';
    $$('.nav-item').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    if (view === 'ninebox') renderNineBox();
    if (view === 'evaluate') renderEvaluate();
    if (view === 'users') renderUsers();
    if (view === 'plan') renderPlan();
    if (view === 'tutorial') renderTutorial();
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

  // Mensagem quando o colaborador ainda não tem avaliação cadastrada.
  function collaboratorEmptyMessage() {
    return 'Sua avaliação ainda não foi cadastrada. Procure seu líder.';
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
      if (canEdit()) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => openMemberModal(m.id));
      } else {
        card.style.cursor = 'default';
      }
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
    if (!canEdit()) return; // colaborador não cadastra/edita
    editingId = id || null;
    const member = id ? members.find((m) => m.id === id) : null;
    $('#modal-title').textContent = member ? 'Editar colaborador' : 'Novo colaborador';
    $('#input-name').value = member ? member.name : '';
    $('#input-email').value = member ? member.email || member.id : '';
    $('#input-role').value = member ? member.role || '' : '';
    // o e-mail é a chave do documento: não pode mudar ao editar
    $('#input-email').disabled = !!member;
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
      // novo colaborador: e-mail (normalizado) é o ID do documento
      const email = Store.normEmail ? Store.normEmail($('#input-email').value) : $('#input-email').value.trim().toLowerCase();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        alert('Informe um e-mail válido — ele será o login do colaborador.');
        $('#input-email').focus();
        return;
      }
      if (members.some((x) => x.id === email)) {
        alert('Já existe um colaborador com esse e-mail.');
        return;
      }
      const m = { id: email, email, name, role, scores: {} };
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
      empty.textContent = canEdit()
        ? 'Selecione um colaborador para avaliar.'
        : collaboratorEmptyMessage();
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
        if (canEdit()) {
          dot.addEventListener('click', () => setScore(member, pillar, comp.name, v));
        } else {
          dot.disabled = true; // colaborador apenas visualiza
          dot.title = 'Somente leitura';
        }
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

    const datasets = [];
    // Marca d'água (média do time) só aparece para o líder: o colaborador, por
    // segurança, só pode ler o próprio documento — não teria os dados do time.
    if (canEdit() && members.length > 1) {
      datasets.push({
        label: 'Média do time',
        data: Model.teamAverageByCompetency(members, pillar, member.id),
        backgroundColor: 'rgba(148, 163, 184, 0.15)',
        borderColor: 'rgba(148, 163, 184, 0.55)',
        borderWidth: 1,
        borderDash: [4, 4],
        pointRadius: 2,
        pointBackgroundColor: 'rgba(148, 163, 184, 0.6)',
      });
    }
    datasets.push({
      label: member.name,
      data: memberData,
      backgroundColor: hexToRgba(pillar.color, 0.25),
      borderColor: pillar.color,
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: pillar.color,
    });

    radarCharts[pillar.id] = new Chart(canvas, {
      type: 'radar',
      data: {
        labels,
        datasets,
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

  // --------------------------- View: Usuários ------------------------------
  async function renderUsers() {
    if (!canEdit()) return; // só líder
    const list = $('#users-list');
    const empty = $('#users-empty');
    list.innerHTML = '';

    let roles = [];
    try {
      roles = await Store.listRoles();
    } catch (e) {
      const perm = e && (e.code === 'permission-denied' || /permission/i.test(e.message || ''));
      list.innerHTML =
        '<p class="empty-state">' +
        (perm
          ? 'Permissão negada ao ler os papéis. Publique as Security Rules novas ' +
            '(coleção <strong>roles</strong>) no Firebase Console → Firestore → Rules.'
          : 'Erro ao carregar papéis: ' + escapeHtml(e?.message || String(e))) +
        '</p>';
      return;
    }

    // Inclui os líderes semeados (bootstrap) na lista, mesmo sem doc em roles.
    const byEmail = {};
    roles.forEach((r) => (byEmail[r.email] = r.role));
    // marca o próprio usuário (bootstrap) como líder se não houver doc
    const me = Store.currentUser ? Store.currentUser.email : null;
    if (me && !byEmail[me]) byEmail[me] = 'leader'; // você é líder por bootstrap

    const entries = Object.entries(byEmail).sort((a, b) => a[0].localeCompare(b[0]));

    if (entries.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    entries.forEach(([email, role]) => {
      const row = document.createElement('div');
      row.className = 'user-row';
      const isMe = email === me;
      row.innerHTML = `
        <div class="user-main">
          <span class="user-email-txt">${escapeHtml(email)}</span>
          ${isMe ? '<span class="user-you">você</span>' : ''}
        </div>
        <span class="role-badge ${role === 'leader' ? 'role-leader' : 'role-collab'}">
          ${role === 'leader' ? 'Líder' : 'Colaborador'}
        </span>
      `;
      // seletor rápido para trocar o papel (bloqueia alterar o próprio, p/ não
      // se auto-rebaixar e perder acesso sem querer)
      const sel = document.createElement('select');
      sel.className = 'select';
      sel.innerHTML =
        '<option value="collaborator">Colaborador</option>' +
        '<option value="leader">Líder</option>';
      sel.value = role === 'leader' ? 'leader' : 'collaborator';
      if (isMe) {
        sel.disabled = true;
        sel.title = 'Você não pode alterar o próprio papel.';
      } else {
        sel.addEventListener('change', async () => {
          await Store.setRole(email, sel.value);
          await renderUsers();
        });
      }
      row.appendChild(sel);

      // Botão excluir o papel (volta ao padrão Colaborador). Bloqueado p/ o próprio.
      const del = document.createElement('button');
      del.className = 'btn btn-danger';
      del.textContent = 'Excluir';
      if (isMe) {
        del.disabled = true;
        del.title = 'Você não pode excluir o próprio papel.';
      } else {
        del.addEventListener('click', async () => {
          if (
            !confirm(
              'Excluir o papel de ' + email + '?\n\n' +
                'Isso remove a classificação (ela volta a Colaborador padrão). ' +
                'O login e a avaliação da pessoa NÃO são apagados.'
            )
          )
            return;
          await Store.removeRole(email);
          await renderUsers();
        });
      }
      row.appendChild(del);

      list.appendChild(row);
    });
  }

  // Botão "Definir papel" (adiciona/atualiza por e-mail digitado)
  $('#btn-set-role').addEventListener('click', async () => {
    if (!canEdit()) return;
    const emailRaw = $('#role-email').value;
    const email = Store.normEmail ? Store.normEmail(emailRaw) : emailRaw.trim().toLowerCase();
    const role = $('#role-select').value;
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      alert('Informe um e-mail válido.');
      return;
    }
    await Store.setRole(email, role);
    $('#role-email').value = '';
    await renderUsers();
  });

  // ------------------- View: Plano de Desenvolvimento (PDI) ----------------
  // O PDI vive dentro de member.plan = [ { id, title, desc, tasks:[{id,text,done}] } ].
  // Só líder edita (opção A); colaborador vê em leitura.
  let planSelectedId = null;

  function planMembers() {
    // líder escolhe qualquer colaborador; colaborador só a si mesmo
    return members;
  }

  function populatePlanSelect() {
    const sel = $('#plan-member-select');
    sel.innerHTML = '';
    const list = planMembers();
    if (list.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = 'Nenhum colaborador';
      opt.value = '';
      sel.appendChild(opt);
      return;
    }
    list.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      sel.appendChild(opt);
    });
    if (!planSelectedId || !list.find((m) => m.id === planSelectedId)) {
      planSelectedId = list[0].id;
    }
    sel.value = planSelectedId;
    // colaborador não troca de pessoa
    sel.classList.toggle('hidden', !canEdit() && list.length <= 1);
  }

  $('#plan-member-select').addEventListener('change', (e) => {
    planSelectedId = e.target.value;
    renderPlan();
  });

  function currentPlanMember() {
    return members.find((m) => m.id === planSelectedId) || null;
  }

  function objectiveProgress(obj) {
    const tasks = obj.tasks || [];
    if (tasks.length === 0) return 0;
    const done = tasks.filter((t) => t.done).length;
    return Math.round((done / tasks.length) * 100);
  }

  function renderPlan() {
    populatePlanSelect();
    $('#btn-add-objective').classList.toggle('hidden', !canEdit());

    const member = currentPlanMember();
    const empty = $('#plan-empty');
    const box = $('#plan-objectives');

    if (!member) {
      empty.textContent = canEdit()
        ? 'Selecione um colaborador.'
        : 'Sua avaliação ainda não foi cadastrada. Procure seu líder.';
      empty.classList.remove('hidden');
      box.classList.add('hidden');
      return;
    }

    const plan = member.plan || [];
    if (plan.length === 0) {
      empty.textContent = canEdit()
        ? 'Nenhum objetivo ainda. Clique em "+ Novo objetivo" para começar.'
        : 'Nenhum objetivo de desenvolvimento cadastrado ainda.';
      empty.classList.remove('hidden');
      box.classList.add('hidden');
      return;
    }

    empty.classList.add('hidden');
    box.classList.remove('hidden');
    box.innerHTML = '';

    plan.forEach((obj) => {
      box.appendChild(buildObjectiveCard(member, obj));
    });
  }

  function buildObjectiveCard(member, obj) {
    const pct = objectiveProgress(obj);
    const card = document.createElement('div');
    card.className = 'objective-card';

    const head = document.createElement('div');
    head.className = 'obj-head';
    head.innerHTML = `
      <div class="obj-titles">
        <div class="obj-title">${escapeHtml(obj.title)}</div>
        ${obj.desc ? `<div class="obj-desc">${escapeHtml(obj.desc)}</div>` : ''}
      </div>
      <div class="obj-pct ${pct === 100 ? 'done' : ''}">${pct}%</div>
    `;
    card.appendChild(head);

    // barra de progresso
    const bar = document.createElement('div');
    bar.className = 'progress';
    const fill = document.createElement('div');
    fill.className = 'progress-fill' + (pct === 100 ? ' full' : '');
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    card.appendChild(bar);

    // tarefas
    const tasks = obj.tasks || [];
    const taskList = document.createElement('div');
    taskList.className = 'task-list';
    tasks.forEach((task) => {
      const row = document.createElement('label');
      row.className = 'task-row' + (task.done ? ' done' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!task.done;
      cb.disabled = !canEdit();
      cb.addEventListener('change', () => toggleTask(member, obj, task, cb.checked));
      const txt = document.createElement('span');
      txt.className = 'task-text';
      txt.textContent = task.text;
      row.appendChild(cb);
      row.appendChild(txt);
      if (canEdit()) {
        const del = document.createElement('button');
        del.className = 'task-del';
        del.textContent = '✕';
        del.title = 'Remover tarefa';
        del.addEventListener('click', (e) => {
          e.preventDefault();
          removeTask(member, obj, task);
        });
        row.appendChild(del);
      }
      taskList.appendChild(row);
    });
    card.appendChild(taskList);

    // ações do líder: adicionar tarefa, editar/excluir objetivo
    if (canEdit()) {
      const addRow = document.createElement('div');
      addRow.className = 'task-add';
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Nova tarefa/ação…';
      input.className = 'select';
      const addBtn = document.createElement('button');
      addBtn.className = 'btn';
      addBtn.textContent = 'Adicionar';
      const doAdd = () => {
        const text = input.value.trim();
        if (!text) return;
        addTask(member, obj, text);
      };
      addBtn.addEventListener('click', doAdd);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doAdd();
      });
      addRow.appendChild(input);
      addRow.appendChild(addBtn);
      card.appendChild(addRow);

      const objActions = document.createElement('div');
      objActions.className = 'obj-actions';
      const editBtn = document.createElement('button');
      editBtn.className = 'btn';
      editBtn.textContent = 'Editar objetivo';
      editBtn.addEventListener('click', () => openObjectiveModal(member, obj.id));
      objActions.appendChild(editBtn);
      card.appendChild(objActions);
    }

    return card;
  }

  function uid() {
    return 'o_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  async function persistPlan(member) {
    await Store.save(member);
    // mantém o array local em sincronia e re-renderiza
    const idx = members.findIndex((m) => m.id === member.id);
    if (idx >= 0) members[idx] = member;
    renderPlan();
  }

  async function addTask(member, obj, text) {
    obj.tasks = obj.tasks || [];
    obj.tasks.push({ id: uid(), text, done: false });
    await persistPlan(member);
  }

  async function toggleTask(member, obj, task, done) {
    task.done = done;
    await persistPlan(member);
  }

  async function removeTask(member, obj, task) {
    obj.tasks = (obj.tasks || []).filter((t) => t.id !== task.id);
    await persistPlan(member);
  }

  // ---- Modal de objetivo ----
  let editingObjectiveId = null;

  function openObjectiveModal(member, objId) {
    if (!canEdit()) return;
    editingObjectiveId = objId || null;
    const obj = objId ? (member.plan || []).find((o) => o.id === objId) : null;
    $('#objective-modal-title').textContent = obj ? 'Editar objetivo' : 'Novo objetivo';
    $('#input-objective-title').value = obj ? obj.title : '';
    $('#input-objective-desc').value = obj ? obj.desc || '' : '';
    $('#btn-delete-objective').classList.toggle('hidden', !obj);
    $('#objective-modal').classList.remove('hidden');
    $('#input-objective-title').focus();
  }

  function closeObjectiveModal() {
    $('#objective-modal').classList.add('hidden');
    editingObjectiveId = null;
  }

  $('#btn-add-objective').addEventListener('click', () => {
    const member = currentPlanMember();
    if (member) openObjectiveModal(member, null);
  });
  $('#btn-cancel-objective').addEventListener('click', closeObjectiveModal);
  $('#objective-modal').addEventListener('click', (e) => {
    if (e.target.id === 'objective-modal') closeObjectiveModal();
  });

  $('#btn-save-objective').addEventListener('click', async () => {
    const member = currentPlanMember();
    if (!member) return;
    const title = $('#input-objective-title').value.trim();
    if (!title) {
      $('#input-objective-title').focus();
      return;
    }
    const desc = $('#input-objective-desc').value.trim();
    member.plan = member.plan || [];
    if (editingObjectiveId) {
      const obj = member.plan.find((o) => o.id === editingObjectiveId);
      if (obj) {
        obj.title = title;
        obj.desc = desc;
      }
    } else {
      member.plan.push({ id: uid(), title, desc, tasks: [] });
    }
    closeObjectiveModal();
    await persistPlan(member);
  });

  $('#btn-delete-objective').addEventListener('click', async () => {
    const member = currentPlanMember();
    if (!member || !editingObjectiveId) return;
    if (!confirm('Excluir este objetivo e suas tarefas?')) return;
    member.plan = (member.plan || []).filter((o) => o.id !== editingObjectiveId);
    closeObjectiveModal();
    await persistPlan(member);
  });

  // --------------------------- View: Tutorial ------------------------------
  function renderTutorial() {
    const body = $('#tutorial-body');
    if (!body || body.dataset.rendered === '1') return; // estático: renderiza uma vez

    const scaleRows = Object.keys(Model.SCALE_LABELS)
      .map((n) => {
        const s = Model.SCALE_LABELS[n];
        return `
          <div class="scale-row">
            <span class="scale-num">${n}</span>
            <div>
              <div class="scale-name">${escapeHtml(s.name)}</div>
              <div class="scale-desc">${escapeHtml(s.desc)}</div>
            </div>
          </div>`;
      })
      .join('');

    const pillarCards = Model.PILLARS.map(
      (p) => `
        <div class="tut-pillar" style="border-top-color:${p.color}">
          <div class="tut-pillar-name">${escapeHtml(p.name)}</div>
          <div class="tut-pillar-sub">${escapeHtml(p.subtitle)}</div>
        </div>`
    ).join('');

    const roleCards = `
      <div class="tut-role">
        <span class="tut-role-badge role-leader">Líder</span>
        <p>Vê e avalia todos os colaboradores, gerencia papéis de acesso e os planos de desenvolvimento.</p>
      </div>
      <div class="tut-role">
        <span class="tut-role-badge role-collab">Colaborador</span>
        <p>Vê apenas a própria avaliação e o próprio plano de desenvolvimento, em modo leitura.</p>
      </div>`;

    body.innerHTML = `
      <!-- Introdução em largura total -->
      <section class="tut-section tut-intro">
        <div class="tut-sec-head"><span class="tut-ico">📊</span><h3>O que é este app</h3></div>
        <p>Uma ferramenta para <strong>avaliar colaboradores</strong> em três pilares, comparar cada
        pessoa com a média do time e posicioná-la numa matriz <strong>Nine Box</strong>
        (Potencial × Desempenho). Também permite acompanhar um
        <strong>Plano de Desenvolvimento</strong> individual para evoluir as notas.</p>
      </section>

      <!-- Linha: pilares + escala -->
      <div class="tut-grid-2">
        <section class="tut-section">
          <div class="tut-sec-head"><span class="tut-ico">🧱</span><h3>Os 3 pilares</h3></div>
          <div class="tut-pillars">${pillarCards}</div>
          <p class="tut-note">Cada pilar reúne competências avaliadas de 1 a 5. A média das
          competências forma a nota do pilar.</p>
        </section>

        <section class="tut-section">
          <div class="tut-sec-head"><span class="tut-ico">🔢</span><h3>Escala de notas</h3></div>
          <div class="scale-list">${scaleRows}</div>
        </section>
      </div>

      <!-- Nine Box em largura total, com os dois eixos lado a lado -->
      <section class="tut-section">
        <div class="tut-sec-head"><span class="tut-ico">🎯</span><h3>Desempenho × Potencial (Nine Box)</h3></div>
        <div class="tut-axes">
          <div class="tut-axis">
            <div class="tut-axis-label">Desempenho — eixo horizontal</div>
            <p>O que a pessoa entrega hoje, calculado pela média de <em>HardSkill</em> e <em>Disciplina</em>.</p>
          </div>
          <div class="tut-axis">
            <div class="tut-axis-label">Potencial — eixo vertical</div>
            <p>Capacidade de crescer e liderar, vinda do pilar <em>SoftSkill</em> (Leadership Principles).</p>
          </div>
        </div>
        <p class="tut-note">O cruzamento dos dois eixos posiciona a pessoa em um dos 9 quadrantes.
        A explicação de cada quadrante está na aba <strong>Nine Box</strong>.</p>
      </section>

      <!-- Linha: PDI + papéis -->
      <div class="tut-grid-2">
        <section class="tut-section">
          <div class="tut-sec-head"><span class="tut-ico">📈</span><h3>Plano de Desenvolvimento</h3></div>
          <p>Para cada colaborador, o líder cadastra <strong>objetivos</strong>, cada um com suas
          <strong>tarefas</strong>. Ao concluir as tarefas, o progresso do objetivo sobe até
          <strong>100%</strong> quando todas estão feitas — o caminho prático para melhorar as notas.</p>
        </section>

        <section class="tut-section">
          <div class="tut-sec-head"><span class="tut-ico">🔑</span><h3>Papéis de acesso</h3></div>
          <div class="tut-roles">${roleCards}</div>
        </section>
      </div>
    `;
    body.dataset.rendered = '1';
  }

  // --------------------------- Ciclo de vida -------------------------------
  async function reloadAndRender() {
    members = await Store.list();
    renderTeam();
    renderEvaluate();
    const activeView = $('.nav-item.active')?.dataset.view;
    if (activeView === 'ninebox') renderNineBox();
    if (activeView === 'plan') renderPlan();
  }

  // fecha o modal ao clicar fora
  $('#member-modal').addEventListener('click', (e) => {
    if (e.target.id === 'member-modal') closeMemberModal();
  });

  // --------------------------- Papel / UI ----------------------------------
  // Mostra/esconde recursos de edição conforme o papel do usuário.
  function applyRoleToUI() {
    const leader = canEdit();
    // botão de cadastrar colaborador só para líderes
    $('#btn-add-member').classList.toggle('hidden', !leader);
    // o seletor de colaborador na aba Avaliação só faz sentido para líder
    $('#member-select').classList.toggle('hidden', !leader);
    // aba de gestão de usuários/papéis só para líderes
    $('#nav-users').classList.toggle('hidden', !leader);

    // rótulo do usuário na sidebar
    const user = Store.currentUser;
    $('#user-email').textContent = user ? user.email : '—';
    $('#user-role').textContent = leader ? 'Líder' : 'Colaborador';
  }

  // --------------------------- Autenticação --------------------------------
  const loginScreen = $('#login-screen');
  const bootScreen = $('#boot-screen');
  const appShell = $('#app-shell');

  function showBoot() {
    bootScreen.classList.remove('hidden');
    loginScreen.classList.add('hidden');
    appShell.classList.add('hidden');
  }
  function showLogin() {
    bootScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    appShell.classList.add('hidden');
    setAuthMode('login');
    $('#login-password').value = '';
  }
  function showApp() {
    bootScreen.classList.add('hidden');
    loginScreen.classList.add('hidden');
    appShell.classList.remove('hidden');
  }

  // Alterna entre "Entrar" e "Criar conta"
  let authMode = 'login'; // 'login' | 'signup'
  function setAuthMode(mode) {
    authMode = mode;
    const isSignup = mode === 'signup';
    $('#login-sub').textContent = isSignup
      ? 'Crie sua conta com o e-mail corporativo.'
      : 'Entre com seu e-mail corporativo.';
    $('#login-submit').textContent = isSignup ? 'Criar conta' : 'Entrar';
    $('#login-mode-hint').textContent = isSignup ? 'Já tem conta?' : 'Ainda não tem conta?';
    $('#login-toggle-link').textContent = isSignup ? 'Entrar' : 'Criar conta';
    $('#login-password').setAttribute('autocomplete', isSignup ? 'new-password' : 'current-password');
    $('#login-error').classList.add('hidden');
  }

  $('#login-toggle-link').addEventListener('click', (e) => {
    e.preventDefault();
    setAuthMode(authMode === 'login' ? 'signup' : 'login');
  });

  // Formulário de login / cadastro
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#login-email').value.trim();
    const password = $('#login-password').value;
    const errEl = $('#login-error');
    const btn = $('#login-submit');
    errEl.classList.add('hidden');
    btn.disabled = true;
    const signup = authMode === 'signup';
    btn.textContent = signup ? 'Criando…' : 'Entrando…';
    try {
      if (signup) {
        await Store.signup(email, password);
      } else {
        await Store.login(email, password);
      }
      // o onAuth cuida de carregar o app
    } catch (err) {
      errEl.textContent = friendlyAuthError(err);
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = signup ? 'Criar conta' : 'Entrar';
    }
  });

  $('#btn-logout').addEventListener('click', async () => {
    await Store.logout();
  });

  function friendlyAuthError(err) {
    const code = err && err.code ? err.code : '';
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'E-mail ou senha incorretos.';
      case 'auth/invalid-email':
        return 'E-mail inválido.';
      case 'auth/email-already-in-use':
        return 'Já existe uma conta com esse e-mail. Use "Entrar".';
      case 'auth/weak-password':
        return 'Senha muito fraca (mínimo 6 caracteres).';
      case 'auth/operation-not-allowed':
        return 'Cadastro por e-mail/senha não está habilitado no Firebase.';
      case 'auth/too-many-requests':
        return 'Muitas tentativas. Tente novamente em alguns minutos.';
      case 'auth/network-request-failed':
        return 'Falha de rede. Verifique sua conexão.';
      default:
        return 'Não foi possível concluir. ' + (err?.message || '');
    }
  }

  // --------------------------- Bootstrap -----------------------------------
  function boot() {
    updateStorageBadge();

    if (Store.mode === 'local') {
      // Sem Firebase: entra direto como líder local (modo de desenvolvimento)
      applyRoleToUI();
      showApp();
      reloadAndRender();
      return;
    }

    // Firebase: aguarda o estado de autenticação
    showBoot();
    Store.onAuth(async (user) => {
      if (!user) {
        showLogin();
        return;
      }
      applyRoleToUI();
      // colaborador abre direto na própria avaliação
      if (!canEdit()) {
        selectedId = Store.emailToId(user.email);
        switchView('evaluate');
      }
      showApp();
      await reloadAndRender();
    });
  }

  boot();
})();
