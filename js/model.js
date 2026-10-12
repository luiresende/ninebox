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

  // Cargos fixos semeados no código. Cargos adicionais criados pelo líder (ou
  // pela importação de CSV) são guardados no Firestore (coleção "cargos") e
  // somados a estes em tempo de execução. No futuro, cada cargo poderá ter sua
  // própria avaliação — por isso o cargo tende a virar entidade central.
  const DEFAULT_ROLES = [
    'Engenheiro DevOps Júnior',
    'Engenheiro DevOps Pleno',
    'Engenheiro DevOps Sênior',
    'Analista de Cloud Júnior',
    'Analista de Cloud Pleno',
    'Analista de Cloud Sênior',
    'Tech Lead',
    'Analista de Processos Júnior',
    'Analista de Processos Pleno',
    'Analista de Processos Sênior',
  ];

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
  // Regras (importante para a costura migração × navegação por trimestre):
  //   1. Se o membro já tem .periods (sempre após migrateOnRead no Store.list),
  //      a verdade é por período: usa member.periods[periodKey].scores quando
  //      existe; caso contrário o trimestre está VAZIO (não "vaza" as notas de
  //      raiz do legado para trimestres onde a pessoa não foi avaliada).
  //   2. RETROCOMPAT: só quando o membro ainda NÃO tem .periods (objeto nunca
  //      migrado) é que caímos nas notas legadas de raiz (member.scores). Isso
  //      mantém chamadas antigas/sintéticas funcionando sem o passo de migração.
  function periodScores(member, periodKey) {
    if (member && member.periods) {
      const p = periodKey && member.periods[periodKey];
      return (p && p.scores) || {};
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

  // ==========================================================================
  //  ASSISTENTE DE SUGESTÕES (motor baseado em regras — sem IA externa/custo)
  // --------------------------------------------------------------------------
  //  Olha as notas do colaborador no trimestre e, para cada competência fraca
  //  (nota <= 3 ou sem nota), sugere um OBJETIVO com TAREFAS a partir deste
  //  catálogo. O líder revisa e escolhe o que adicionar ao PDI.
  //  Edite os textos abaixo livremente para adequar à realidade do time.
  // ==========================================================================
  const SUGGEST_THRESHOLD = 3; // competência "fraca" = nota <= 3 (ou sem nota)

  // catálogo indexado pelo NOME exato da competência (ver PILLARS acima)
  const SUGGESTION_CATALOG = {
    // ---- HardSkill (DevOps & Cloud) ----
    'Cloud / AWS': {
      title: 'Elevar proficiência em Cloud/AWS',
      tasks: [
        'Concluir um curso ou trilha oficial de fundamentos de AWS',
        'Desenhar e documentar a arquitetura de um serviço usando Well-Architected',
        'Configurar IAM com least privilege em um projeto real',
      ],
    },
    'CI/CD': {
      title: 'Fortalecer práticas de CI/CD',
      tasks: [
        'Criar um pipeline completo (build, teste, deploy) para um serviço',
        'Adicionar gates de qualidade (lint, testes, cobertura) ao pipeline',
        'Implementar deploy automatizado em pelo menos um ambiente',
      ],
    },
    'IaC (Terraform)': {
      title: 'Dominar Infraestrutura como Código (Terraform)',
      tasks: [
        'Migrar um recurso provisionado manualmente para Terraform',
        'Criar um módulo reutilizável (ex: VPC ou bucket)',
        'Configurar remote state com bloqueio (ex: S3 + DynamoDB)',
      ],
    },
    'Containers / K8s': {
      title: 'Aprofundar em Containers e Kubernetes',
      tasks: [
        'Containerizar uma aplicação com Dockerfile otimizado',
        'Implantar a aplicação em um cluster (deployment + service)',
        'Praticar troubleshooting de pods (logs, describe, exec)',
      ],
    },
    'Observabilidade': {
      title: 'Melhorar observabilidade de sistemas',
      tasks: [
        'Instrumentar uma aplicação com métricas e logs estruturados',
        'Criar um dashboard com os principais indicadores do serviço',
        'Configurar um alerta acionável para um sintoma de falha',
      ],
    },
    'Segurança': {
      title: 'Reforçar práticas de Segurança',
      tasks: [
        'Revisar e aplicar gestão de segredos (sem credenciais no código)',
        'Executar uma análise de vulnerabilidades em uma aplicação',
        'Aplicar hardening/least privilege em um ambiente',
      ],
    },
    // ---- SoftSkill (Leadership Principles) ----
    'Customer Obsession': {
      title: 'Desenvolver foco no cliente',
      tasks: [
        'Mapear as principais dores de um cliente/stakeholder do seu produto',
        'Propor uma melhoria partindo da necessidade do cliente',
        'Coletar feedback direto de um usuário e agir sobre ele',
      ],
    },
    'Ownership': {
      title: 'Fortalecer senso de dono (Ownership)',
      tasks: [
        'Assumir a ponta a ponta de uma entrega, incluindo o pós-deploy',
        'Documentar e resolver um problema recorrente do time',
        'Antecipar um risco e propor um plano de mitigação',
      ],
    },
    'Invent and Simplify': {
      title: 'Praticar inovação e simplificação',
      tasks: [
        'Identificar um processo complexo e propor uma versão mais simples',
        'Trazer uma ideia nova para resolver um problema do time',
        'Eliminar um passo manual automatizando-o',
      ],
    },
    'Deliver Results': {
      title: 'Melhorar a entrega de resultados',
      tasks: [
        'Definir metas claras e mensuráveis para a próxima entrega',
        'Quebrar um objetivo grande em marcos semanais',
        'Comunicar riscos de prazo cedo e propor alternativas',
      ],
    },
    'Earn Trust': {
      title: 'Construir confiança (Earn Trust)',
      tasks: [
        'Dar e pedir feedback de forma estruturada com um colega',
        'Praticar escuta ativa em reuniões (resumir antes de responder)',
        'Assumir publicamente um erro e o aprendizado dele',
      ],
    },
    'Dive Deep': {
      title: 'Desenvolver profundidade de análise (Dive Deep)',
      tasks: [
        'Investigar a causa raiz de um incidente (5 porquês)',
        'Validar uma decisão com dados antes de concluir',
        'Auditar uma métrica suspeita até entender a divergência',
      ],
    },
    // ---- Disciplina ----
    'Pontualidade': {
      title: 'Melhorar pontualidade e presença',
      tasks: [
        'Chegar e iniciar compromissos no horário por 4 semanas seguidas',
        'Usar lembretes/agenda para compromissos recorrentes',
        'Comunicar com antecedência quando houver imprevisto',
      ],
    },
    'Organização': {
      title: 'Aprimorar organização do trabalho',
      tasks: [
        'Manter o backlog pessoal priorizado e atualizado',
        'Adotar um método de gestão de tarefas (ex: Kanban pessoal)',
        'Revisar prioridades no início de cada semana',
      ],
    },
    'Cumprimento de prazos': {
      title: 'Melhorar cumprimento de prazos',
      tasks: [
        'Estimar tarefas e comparar o estimado x realizado',
        'Sinalizar riscos de atraso assim que identificados',
        'Entregar dentro do prazo acordado em um ciclo completo',
      ],
    },
    'Documentação': {
      title: 'Fortalecer a cultura de documentação',
      tasks: [
        'Escrever um runbook para um processo que você domina',
        'Documentar as decisões técnicas de uma entrega (ADR)',
        'Revisar e atualizar uma documentação desatualizada',
      ],
    },
    'Processos': {
      title: 'Aderir e aprimorar processos do time',
      tasks: [
        'Seguir o fluxo de code review em todas as entregas do ciclo',
        'Propor uma melhoria em um ritual ou processo do time',
        'Documentar um processo que hoje é informal',
      ],
    },
    'Proatividade': {
      title: 'Desenvolver proatividade',
      tasks: [
        'Identificar e propor a solução de um problema sem ser solicitado',
        'Assumir uma melhoria técnica fora da demanda imediata',
        'Oferecer ajuda a um colega em um ponto de bloqueio',
      ],
    },
  };

  // Objetivo de APROFUNDAMENTO quando a competência já vai bem (nota 4-5),
  // usado como fallback para levar de "avançado" a "experiente".
  function deepenTemplate(compName) {
    return {
      title: 'Tornar-se referência em ' + compName,
      tasks: [
        'Mentorar um colega na competência "' + compName + '"',
        'Definir um padrão/boa prática do time para "' + compName + '"',
        'Compartilhar conhecimento (talk, artigo ou dojo) sobre "' + compName + '"',
      ],
    };
  }

  // Gera sugestões de objetivos a partir das notas do trimestre.
  // Retorna lista ordenada da competência mais fraca para a mais forte:
  //   [{ pillarId, pillarName, competency, score, title, tasks:[string] }]
  // - Prioriza competências com nota <= SUGGEST_THRESHOLD (ou sem nota).
  // - Se TODAS vão bem, sugere aprofundamento das mais baixas mesmo assim.
  function suggestObjectives(member, periodKey, limit) {
    const scores = periodScores(member, periodKey);
    const items = [];
    PILLARS.forEach((pillar) => {
      const pScores = scores[pillar.id] || {};
      pillar.competencies.forEach((comp) => {
        const raw = Number(pScores[comp.name]);
        const has = Number.isFinite(raw);
        const score = has ? raw : 0; // sem nota conta como mais fraco
        items.push({
          pillarId: pillar.id,
          pillarName: pillar.name,
          competency: comp.name,
          score: has ? raw : null,
          _sort: score,
          weak: !has || raw <= SUGGEST_THRESHOLD,
        });
      });
    });

    // ordena da mais fraca para a mais forte
    items.sort((a, b) => a._sort - b._sort);

    // se existe alguma fraca, sugere só as fracas; senão, aprofunda as menores
    const anyWeak = items.some((i) => i.weak);
    const chosen = (anyWeak ? items.filter((i) => i.weak) : items).slice(
      0,
      limit || 6
    );

    return chosen.map((i) => {
      const tpl =
        i.weak && SUGGESTION_CATALOG[i.competency]
          ? SUGGESTION_CATALOG[i.competency]
          : deepenTemplate(i.competency);
      return {
        pillarId: i.pillarId,
        pillarName: i.pillarName,
        competency: i.competency,
        score: i.score,
        title: tpl.title,
        desc:
          (i.score == null ? 'Sem nota' : 'Nota ' + i.score) +
          ' em ' + i.competency + ' (' + i.pillarName + ')',
        tasks: tpl.tasks.slice(),
      };
    });
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
    suggestObjectives,
    SUGGESTION_CATALOG,
    DEFAULT_ROLES,
  };
})();
