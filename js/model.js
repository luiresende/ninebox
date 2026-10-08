// ============================================================================
// MODELO: pilares, competências e cálculos
// ----------------------------------------------------------------------------
// Centraliza TODA a regra de negócio: quais pilares existem, quais competências
// compõem cada um, e como as notas viram Desempenho / Potencial / Nine Box.
// Ajuste aqui para mudar competências ou a fórmula sem mexer na UI.
//
// Cada competência é um objeto { name, desc }:
//   name -> rótulo exibido e chave da nota salva
//   desc -> descrição curta exibida abaixo do nome na tela de avaliação
// ============================================================================

(function () {
  const SCALE_MIN = 1;
  const SCALE_MAX = 5;

  // Rótulos da escala de notas (1..5), usados no Tutorial e como referência.
  const SCALE_LABELS = {
    1: { name: 'Muito baixo', desc: 'Pouco ou nenhum conhecimento/entrega na competência. Precisa de apoio constante.' },
    2: { name: 'Básico', desc: 'Conhecimento inicial. Executa tarefas simples com supervisão.' },
    3: { name: 'Intermediário', desc: 'Atua de forma independente na maioria das situações do dia a dia.' },
    4: { name: 'Avançado', desc: 'Domínio sólido. Resolve problemas complexos e orienta colegas.' },
    5: { name: 'Experiente', desc: 'Referência no tema. Lidera, define padrões e desenvolve outras pessoas.' },
  };

  // --- Definição dos 3 pilares e suas competências (eixos do radar) ---------
  const PILLARS = [
    {
      id: 'hard',
      name: 'HardSkill',
      subtitle: 'DevOps & Cloud',
      color: '#2563eb', // azul
      competencies: [
        { name: 'Cloud / AWS', desc: 'Domínio de serviços de nuvem (compute, rede, storage, IAM) e boas práticas de arquitetura.' },
        { name: 'CI/CD', desc: 'Automação de build, teste e deploy; pipelines confiáveis e reproduzíveis.' },
        { name: 'IaC (Terraform)', desc: 'Provisionamento de infraestrutura como código, com estado e módulos bem organizados.' },
        { name: 'Containers / K8s', desc: 'Containerização e orquestração: Docker, Kubernetes, deploys e troubleshooting.' },
        { name: 'Observabilidade', desc: 'Logs, métricas e tracing; capacidade de diagnosticar e monitorar sistemas em produção.' },
        { name: 'Segurança', desc: 'Práticas de segurança: gestão de segredos, least privilege, hardening e compliance.' },
      ],
    },
    {
      id: 'soft',
      name: 'SoftSkill',
      subtitle: 'Leadership Principles (AWS)',
      color: '#7c3aed', // roxo
      competencies: [
        { name: 'Customer Obsession', desc: 'Começa pelo cliente e trabalha de trás pra frente; prioriza a confiança do cliente.' },
        { name: 'Ownership', desc: 'Pensa no longo prazo, age em nome de toda a empresa e nunca diz "não é meu trabalho".' },
        { name: 'Invent and Simplify', desc: 'Busca inovação e formas de simplificar; aberto a novas ideias de qualquer origem.' },
        { name: 'Deliver Results', desc: 'Foca nos insumos-chave e entrega com qualidade e no prazo, apesar dos obstáculos.' },
        { name: 'Earn Trust', desc: 'Escuta com atenção, fala com franqueza e trata os outros com respeito; constrói confiança.' },
        { name: 'Dive Deep', desc: 'Opera em todos os níveis, verifica os detalhes e questiona quando os números divergem.' },
      ],
    },
    {
      id: 'discipline',
      name: 'Disciplina',
      subtitle: 'Consistência & Processos',
      color: '#059669', // verde
      competencies: [
        { name: 'Pontualidade', desc: 'Presença e cumprimento de horários e compromissos combinados.' },
        { name: 'Organização', desc: 'Gestão do próprio trabalho, do backlog e das prioridades de forma estruturada.' },
        { name: 'Cumprimento de prazos', desc: 'Entrega consistente dentro dos prazos acordados, comunicando riscos cedo.' },
        { name: 'Documentação', desc: 'Registra decisões, runbooks e conhecimento de forma clara e acessível ao time.' },
        { name: 'Processos', desc: 'Segue e aprimora os processos do time (code review, change management, rituais).' },
        { name: 'Proatividade', desc: 'Antecipa problemas e age sem esperar ser solicitado; propõe melhorias.' },
      ],
    },
  ];

  // --- Pesos para compor os eixos do Nine Box -------------------------------
  // Desempenho (horizontal) = o que a pessoa entrega hoje  -> HardSkill + Disciplina
  // Potencial  (vertical)   = capacidade de crescer/liderar -> SoftSkill
  // Altere os pesos abaixo (somam 1 dentro de cada eixo) se quiser outra regra.
  const PERFORMANCE_WEIGHTS = { hard: 0.5, discipline: 0.5, soft: 0 };
  const POTENTIAL_WEIGHTS = { soft: 1, hard: 0, discipline: 0 };

  // Nomes das competências de um pilar (ordem canônica dos eixos do radar).
  function compNames(pillar) {
    return pillar.competencies.map((c) => c.name);
  }

  // --- Helpers --------------------------------------------------------------

  // Resolve as notas de um colaborador para um trimestre específico.
  // Se houver member.periods[periodKey].scores, usa-o; caso contrário cai no
  // RETROCOMPAT: as notas legadas no topo (member.scores). Assim, chamadas com
  // periodKey undefined (como as atuais da UI) continuam funcionando como antes.
  function periodScores(member, periodKey) {
    if (
      member &&
      member.periods &&
      periodKey &&
      member.periods[periodKey] &&
      member.periods[periodKey].scores
    ) {
      return member.periods[periodKey].scores;
    }
    return (member && member.scores) || {};
  }

  // Média das notas de um pilar para um colaborador. Competências sem nota
  // contam como 0 para não inflar o resultado de quem não foi avaliado.
  function pillarAverage(member, pillar, periodKey) {
    const scores = periodScores(member, periodKey)[pillar.id] || {};
    const total = compNames(pillar).reduce((sum, comp) => {
      const v = Number(scores[comp]);
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0);
    return total / pillar.competencies.length;
  }

  // Média do time (todos os membros exceto o informado) por competência,
  // para desenhar a "marca d'água" de comparação no radar.
  function teamAverageByCompetency(members, pillar, excludeId, periodKey) {
    const others = members.filter((m) => m.id !== excludeId);
    return compNames(pillar).map((comp) => {
      if (others.length === 0) return 0;
      const sum = others.reduce((acc, m) => {
        const v = Number(periodScores(m, periodKey)?.[pillar.id]?.[comp]);
        return acc + (Number.isFinite(v) ? v : 0);
      }, 0);
      return sum / others.length;
    });
  }

  // Notas do colaborador em um pilar, na ordem das competências.
  function memberScoresByCompetency(member, pillar, periodKey) {
    const scores = periodScores(member, periodKey)[pillar.id] || {};
    return compNames(pillar).map((comp) => {
      const v = Number(scores[comp]);
      return Number.isFinite(v) ? v : 0;
    });
  }

  function weightedAxis(member, weights, periodKey) {
    return PILLARS.reduce((acc, pillar) => {
      const w = weights[pillar.id] || 0;
      return acc + w * pillarAverage(member, pillar, periodKey);
    }, 0);
  }

  function performanceScore(member, periodKey) {
    return weightedAxis(member, PERFORMANCE_WEIGHTS, periodKey);
  }

  function potentialScore(member, periodKey) {
    return weightedAxis(member, POTENTIAL_WEIGHTS, periodKey);
  }

  // Converte uma nota (1..5) em faixa baixa/média/alta (0,1,2).
  function band(value) {
    // divide a escala em 3 faixas iguais
    const span = (SCALE_MAX - SCALE_MIN) / 3;
    if (value <= SCALE_MIN + span) return 0; // baixo
    if (value <= SCALE_MIN + 2 * span) return 1; // médio
    return 2; // alto
  }

  // Metadados dos 9 quadrantes, indexados por [potencial][desempenho].
  // name  -> rótulo curto exibido no card e no gráfico
  // desc  -> explicação do que o quadrante representa e a ação sugerida de RH
  const NINE_BOX = [
    // potencial BAIXO
    [
      { name: 'Risco', desc: 'Baixo desempenho e baixo potencial. Requer plano de ação imediato (PIP) ou revisão de fit; se não evoluir, é candidato a desligamento.' },
      { name: 'Eficaz', desc: 'Desempenho mediano e baixo potencial. Entrega o combinado, mas tende a estagnar. Mantenha engajado no papel atual.' },
      { name: 'Especialista', desc: 'Alto desempenho e baixo potencial de crescer para outros papéis. Referência técnica no que faz; retenha e reconheça como expert.' },
    ],
    // potencial MÉDIO
    [
      { name: 'Dilema', desc: 'Potencial médio mas desempenho baixo. Talento subaproveitado: investigue bloqueios, dê feedback e realoque se necessário.' },
      { name: 'Mantenedor', desc: 'Desempenho e potencial medianos. Núcleo sólido do time. Desenvolva pontos específicos para destravar o próximo nível.' },
      { name: 'Forte desempenho', desc: 'Alto desempenho e potencial médio. Entregador confiável. Estimule com desafios para ativar o potencial de crescimento.' },
    ],
    // potencial ALTO
    [
      { name: 'Enigma', desc: 'Alto potencial mas desempenho baixo. Pode estar no papel errado ou desengajado. Entenda a causa e redirecione rápido.' },
      { name: 'Crescimento', desc: 'Alto potencial e bom desempenho. Futuro líder/talento-chave. Acelere com mentoria, projetos ambiciosos e visibilidade.' },
      { name: 'Estrela', desc: 'Alto desempenho e alto potencial. Top talent da organização. Retenha a todo custo, prepare para sucessão e papéis de liderança.' },
    ],
  ];

  function nineBoxCell(member, periodKey) {
    const p = band(potentialScore(member, periodKey)); // linha (0=baixo .. 2=alto)
    const d = band(performanceScore(member, periodKey)); // coluna
    return NINE_BOX[p][d];
  }

  function nineBoxLabel(member, periodKey) {
    return nineBoxCell(member, periodKey).name;
  }

  window.Model = {
    SCALE_MIN,
    SCALE_MAX,
    SCALE_LABELS,
    PILLARS,
    NINE_BOX,
    compNames,
    periodScores,
    pillarAverage,
    teamAverageByCompetency,
    memberScoresByCompetency,
    performanceScore,
    potentialScore,
    nineBoxCell,
    nineBoxLabel,
    band,
  };
})();
