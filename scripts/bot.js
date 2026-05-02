const { Client, GatewayIntentBits, Events } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ============================================================
// CHANNEL REGISTRY — Maps channel IDs to their metadata
// ============================================================
const CHANNEL_MAP = {
  // Openclaw-comms (1481205775710949428)
  '1499729446494802011': { server: 'Openclaw-comms', name: 'deployments', agent: null, purpose: 'Deployment notifications' },
  '1499729509572808834': { server: 'Openclaw-comms', name: 'monitoring', agent: null, purpose: 'Health alerts' },
  '1499729511611367544': { server: 'Openclaw-comms', name: 'security', agent: null, purpose: 'Security events' },
  '1499729513486090350': { server: 'Openclaw-comms', name: 'operations', agent: null, purpose: 'Operations updates' },
  '1499729515088314429': { server: 'Openclaw-comms', name: 'agent-commands', agent: null, purpose: 'Bot commands' },
  '1500087193442451578': { server: 'Openclaw-comms', name: 'voice-comm', agent: null, purpose: 'Voice communication' },

  // VOICE-COMM (1500106236669071534)
  '1500106852615192626': { server: 'VOICE-COMM', name: 'devforge-voicecomm-core-interface', agent: 'DevForge AI', purpose: 'VOICE-COMM-001' },
  '1500106928423178417': { server: 'VOICE-COMM', name: 'devforge-voicecomm-hitl-approval', agent: 'DevForge AI', purpose: 'VOICE-COMM-002' },
  '1500107082647470132': { server: 'VOICE-COMM', name: 'devforge-voicecomm-document-attach', agent: 'DevForge AI', purpose: 'VOICE-COMM-003' },
  '1500107182299938966': { server: 'VOICE-COMM', name: 'devforge-voicecomm-audit-logging', agent: 'DevForge AI', purpose: 'VOICE-COMM-004' },
  '1500107298314649732': { server: 'VOICE-COMM', name: 'mobileforge-voicecomm-mobile-call', agent: 'MobileForge AI', purpose: 'VOICE-COMM-101' },
  '1500107364370616471': { server: 'VOICE-COMM', name: 'mobileforge-voicecomm-mobile-docs', agent: 'MobileForge AI', purpose: 'VOICE-COMM-102' },

  // PROCURE-TEST (1500115728769093632)
  '1500118995213484053': { server: 'PROCURE-TEST', name: 'devforge-procure-foundation', agent: 'DevForge AI', purpose: 'PROCURE-001' },
  '1500118997558104157': { server: 'PROCURE-TEST', name: 'infraforge-procure-database', agent: 'InfraForge AI', purpose: 'PROCURE-002' },
  '1500118999630090272': { server: 'PROCURE-TEST', name: 'devforge-procure-agents', agent: 'DevForge AI', purpose: 'PROCURE-003' },
  '1500119002138148916': { server: 'PROCURE-TEST', name: 'devforge-procure-upserts', agent: 'DevForge AI', purpose: 'PROCURE-004' },
  '1500119004180779043': { server: 'PROCURE-TEST', name: 'devforge-procure-workspace', agent: 'DevForge AI', purpose: 'PROCURE-005' },
  '1500119007066456134': { server: 'PROCURE-TEST', name: 'devforge-procure-chatbot', agent: 'DevForge AI', purpose: 'PROCURE-006' },
  '1500119009134121081': { server: 'PROCURE-TEST', name: 'domainforge-procure-workflow', agent: 'DomainForge AI', purpose: 'PROCURE-007' },
  '1500119011252371538': { server: 'PROCURE-TEST', name: 'domainforge-procure-templates', agent: 'DomainForge AI', purpose: 'PROCURE-008' },
  '1500119013282283661': { server: 'PROCURE-TEST', name: 'domainforge-procure-suppliers', agent: 'DomainForge AI', purpose: 'PROCURE-009' },
  '1500119015509463120': { server: 'PROCURE-TEST', name: 'domainforge-procure-tenders', agent: 'DomainForge AI', purpose: 'PROCURE-010' },
  '1500119017560739890': { server: 'PROCURE-TEST', name: 'infraforge-procure-integrations', agent: 'InfraForge AI', purpose: 'PROCURE-011' },
  '1500119020450349076': { server: 'PROCURE-TEST', name: 'devforge-procure-compliance', agent: 'DevForge AI', purpose: 'PROCURE-012' },
  '1500119022367412284': { server: 'PROCURE-TEST', name: 'devforge-procure-delegation', agent: 'DevForge AI', purpose: 'PROCURE-013' },
  '1500119024732733540': { server: 'PROCURE-TEST', name: 'devforge-procure-feedback', agent: 'DevForge AI', purpose: 'PROCURE-014' },
  '1500119027371216990': { server: 'PROCURE-TEST', name: 'devforge-procure-signoff', agent: 'DevForge AI', purpose: 'PROCURE-015' },
  '1500119029359316992': { server: 'PROCURE-TEST', name: 'qualityforge-procure-regression', agent: 'QualityForge AI', purpose: 'PROCURE-016' },

  // PROCUREMENT-BIDDING (1500116207552954540)
  '1500119413083602987': { server: 'PROCUREMENT-BIDDING', name: 'devforge-btnd-platform', agent: 'DevForge AI', purpose: 'BTND-PLATFORM' },
  '1500119415554048174': { server: 'PROCUREMENT-BIDDING', name: 'paperclipforge-proc-001', agent: 'PaperclipForge AI', purpose: 'PROC-001' },
  '1500119418058051717': { server: 'PROCUREMENT-BIDDING', name: 'paperclipforge-proc-amend', agent: 'PaperclipForge AI', purpose: 'PROC-AMEND' },
  '1500119420557725888': { server: 'PROCUREMENT-BIDDING', name: 'knowledgeforge-proc-analytics', agent: 'KnowledgeForge AI', purpose: 'PROC-ANALYTICS' },
  '1500119422369796192': { server: 'PROCUREMENT-BIDDING', name: 'qualityforge-proc-audit', agent: 'QualityForge AI', purpose: 'PROC-AUDIT' },
  '1500119424722800810': { server: 'PROCUREMENT-BIDDING', name: 'paperclipforge-proc-budget', agent: 'PaperclipForge AI', purpose: 'PROC-BUDGET' },
  '1500119426652049438': { server: 'PROCUREMENT-BIDDING', name: 'paperclipforge-proc-emerg', agent: 'PaperclipForge AI', purpose: 'PROC-EMERG' },
  '1500119428820631722': { server: 'PROCUREMENT-BIDDING', name: 'knowledgeforge-proc-intel', agent: 'KnowledgeForge AI', purpose: 'PROC-INTEL' },
  '1500119431840403579': { server: 'PROCUREMENT-BIDDING', name: 'paperclipforge-proc-inv', agent: 'PaperclipForge AI', purpose: 'PROC-INV' },
  '1500119433970974960': { server: 'PROCUREMENT-BIDDING', name: 'paperclipforge-proc-long', agent: 'PaperclipForge AI', purpose: 'PROC-LONG' },
  '1500119436190023720': { server: 'PROCUREMENT-BIDDING', name: 'qualityforge-proc-ncr', agent: 'QualityForge AI', purpose: 'PROC-NCR' },
  '1500119438295302234': { server: 'PROCUREMENT-BIDDING', name: 'devforge-proc-order', agent: 'DevForge AI', purpose: 'PROC-ORDER' },
  '1500119439834611723': { server: 'PROCUREMENT-BIDDING', name: 'paperclipforge-proc-service', agent: 'PaperclipForge AI', purpose: 'PROC-SERVICE' },
  '1500119442762371203': { server: 'PROCUREMENT-BIDDING', name: 'paperclipforge-proc-supp', agent: 'PaperclipForge AI', purpose: 'PROC-SUPP' },
  '1500119445601915091': { server: 'PROCUREMENT-BIDDING', name: 'paperclipforge-proc-track', agent: 'PaperclipForge AI', purpose: 'PROC-TRACK' },
  '1500119447749529681': { server: 'PROCUREMENT-BIDDING', name: 'paperclipforge-proc-vetting', agent: 'PaperclipForge AI', purpose: 'PROC-VETTING' },
  '1500119449758334997': { server: 'PROCUREMENT-BIDDING', name: 'voiceforge-proc-voice', agent: 'VoiceForge AI', purpose: 'PROC-VOICE' },

  // SAFETY (1500117103817134131)
  '1500118682368475167': { server: 'SAFETY', name: 'voiceforge-safety-voice', agent: 'VoiceForge AI', purpose: 'SAFE-VOICE' },
  '1500118685006954537': { server: 'SAFETY', name: 'devforge-safety-contractor', agent: 'DevForge AI', purpose: 'SAFETY-CONTRACTOR' },
  '1500118687791845507': { server: 'SAFETY', name: 'devforge-safety-emergency', agent: 'DevForge AI', purpose: 'SAFETY-EMERGENCY' },
  '1500118689943523500': { server: 'SAFETY', name: 'devforge-safety-hazard', agent: 'DevForge AI', purpose: 'SAFETY-HAZARD' },
  '1500118692162437221': { server: 'SAFETY', name: 'devforge-safety-health', agent: 'DevForge AI', purpose: 'SAFETY-HEALTH' },
  '1500118694406258769': { server: 'SAFETY', name: 'devforge-safety-incident', agent: 'DevForge AI', purpose: 'SAFETY-INCIDENT' },
  '1500118697111588945': { server: 'SAFETY', name: 'devforge-safety-inspection', agent: 'DevForge AI', purpose: 'SAFETY-INSPECTION' },
  '1500118698965598208': { server: 'SAFETY', name: 'devforge-safety-ppe', agent: 'DevForge AI', purpose: 'SAFETY-PPE' },
  '1500118701242974349': { server: 'SAFETY', name: 'knowledgeforge-safety-research', agent: 'KnowledgeForge AI', purpose: 'SAFETY-RESEARCH-ENHANCEMENT' },
  '1500118703612760225': { server: 'SAFETY', name: 'devforge-safety-training', agent: 'DevForge AI', purpose: 'SAFETY-TRAINING' },

  // ELEC-TEST (1500117452238098554)
  '1500118034470404136': { server: 'ELEC-TEST', name: 'devforge-elec-test-foundation', agent: 'DevForge AI', purpose: 'ELEC-TEST-001' },
  '1500118036949237860': { server: 'ELEC-TEST', name: 'infraforge-elec-test-database', agent: 'InfraForge AI', purpose: 'ELEC-TEST-002' },
  '1500118039415488714': { server: 'ELEC-TEST', name: 'devforge-elec-test-agents', agent: 'DevForge AI', purpose: 'ELEC-TEST-003' },
  '1500118041533354084': { server: 'ELEC-TEST', name: 'devforge-elec-test-upserts', agent: 'DevForge AI', purpose: 'ELEC-TEST-004' },
  '1500118043798536356': { server: 'ELEC-TEST', name: 'devforge-elec-test-workspace', agent: 'DevForge AI', purpose: 'ELEC-TEST-005' },
  '1500118045899624590': { server: 'ELEC-TEST', name: 'devforge-elec-test-chatbot', agent: 'DevForge AI', purpose: 'ELEC-TEST-006' },
  '1500118048013549722': { server: 'ELEC-TEST', name: 'domainforge-elec-test-workflow', agent: 'DomainForge AI', purpose: 'ELEC-TEST-007' },
  '1500118050584793260': { server: 'ELEC-TEST', name: 'domainforge-elec-test-templates', agent: 'DomainForge AI', purpose: 'ELEC-TEST-008' },
  '1500118052883271760': { server: 'ELEC-TEST', name: 'domainforge-elec-test-suppliers', agent: 'DomainForge AI', purpose: 'ELEC-TEST-009' },
  '1500118054762451074': { server: 'ELEC-TEST', name: 'domainforge-elec-test-tenders', agent: 'DomainForge AI', purpose: 'ELEC-TEST-010' },
  '1500118057270513725': { server: 'ELEC-TEST', name: 'infraforge-elec-test-integrations', agent: 'InfraForge AI', purpose: 'ELEC-TEST-011' },
  '1500118059610804305': { server: 'ELEC-TEST', name: 'devforge-elec-test-compliance', agent: 'DevForge AI', purpose: 'ELEC-TEST-012' },
  '1500118061405966438': { server: 'ELEC-TEST', name: 'devforge-elec-test-delegation', agent: 'DevForge AI', purpose: 'ELEC-TEST-013' },
  '1500118063599718522': { server: 'ELEC-TEST', name: 'devforge-elec-test-feedback', agent: 'DevForge AI', purpose: 'ELEC-TEST-014' },
  '1500118065508257933': { server: 'ELEC-TEST', name: 'devforge-elec-test-signoff', agent: 'DevForge AI', purpose: 'ELEC-TEST-015' },
  '1500118068444266536': { server: 'ELEC-TEST', name: 'qualityforge-elec-test-regression', agent: 'QualityForge AI', purpose: 'ELEC-TEST-016' },

  // ELEC-PROJECTS (1500129930053161010)
  '1500134762340290650': { server: 'ELEC-PROJECTS', name: 'devforge-elec-voice', agent: 'DevForge AI', purpose: 'ELEC-VOICE' },
  '1500134809425543178': { server: 'ELEC-PROJECTS', name: 'domainforge-elec-workflow', agent: 'DomainForge AI', purpose: 'ELEC-WORKFLOW' },

  // QS-TEST (1500129675916214486)
  '1500134848046698646': { server: 'QS-TEST', name: 'devforge-qs-test-foundation', agent: 'DevForge AI', purpose: 'QS-TEST-001' },
  '1500134849644597292': { server: 'QS-TEST', name: 'infraforge-qs-test-database', agent: 'InfraForge AI', purpose: 'QS-TEST-002' },
  '1500134852194730160': { server: 'QS-TEST', name: 'devforge-qs-test-agents', agent: 'DevForge AI', purpose: 'QS-TEST-003' },
  '1500134855004913664': { server: 'QS-TEST', name: 'devforge-qs-test-upserts', agent: 'DevForge AI', purpose: 'QS-TEST-004' },
  '1500134857182019604': { server: 'QS-TEST', name: 'devforge-qs-test-workspace', agent: 'DevForge AI', purpose: 'QS-TEST-005' },
  '1500134859081777292': { server: 'QS-TEST', name: 'devforge-qs-test-chatbot', agent: 'DevForge AI', purpose: 'QS-TEST-006' },
  '1500134861128601663': { server: 'QS-TEST', name: 'domainforge-qs-test-workflow', agent: 'DomainForge AI', purpose: 'QS-TEST-007' },
  '1500134863024685137': { server: 'QS-TEST', name: 'domainforge-qs-test-templates', agent: 'DomainForge AI', purpose: 'QS-TEST-008' },
  '1500134865889398844': { server: 'QS-TEST', name: 'domainforge-qs-test-suppliers', agent: 'DomainForge AI', purpose: 'QS-TEST-009' },
  '1500134867898208356': { server: 'QS-TEST', name: 'domainforge-qs-test-tenders', agent: 'DomainForge AI', purpose: 'QS-TEST-010' },
  '1500134869806878750': { server: 'QS-TEST', name: 'infraforge-qs-test-integrations', agent: 'InfraForge AI', purpose: 'QS-TEST-011' },
  '1500134872369332284': { server: 'QS-TEST', name: 'devforge-qs-test-compliance', agent: 'DevForge AI', purpose: 'QS-TEST-012' },
  '1500134874009305250': { server: 'QS-TEST', name: 'devforge-qs-test-delegation', agent: 'DevForge AI', purpose: 'QS-TEST-013' },
  '1500134876689731714': { server: 'QS-TEST', name: 'devforge-qs-test-feedback', agent: 'DevForge AI', purpose: 'QS-TEST-014' },
  '1500134878795010148': { server: 'QS-TEST', name: 'devforge-qs-test-signoff', agent: 'DevForge AI', purpose: 'QS-TEST-015' },
  '1500134881727086654': { server: 'QS-TEST', name: 'qualityforge-qs-test-regression', agent: 'QualityForge AI', purpose: 'QS-TEST-016' },

  // CONTRACTS-QS (1500130883154219258)
  '1500134934331785367': { server: 'CONTRACTS-QS', name: 'domainforge-con-voice', agent: 'DomainForge AI', purpose: 'CON-VOICE' },
  '1500134935942660139': { server: 'CONTRACTS-QS', name: 'domainforge-cpost-voice', agent: 'DomainForge AI', purpose: 'CPOST-VOICE' },
  '1500134938769363046': { server: 'CONTRACTS-QS', name: 'domainforge-cpre-voice', agent: 'DomainForge AI', purpose: 'CPRE-VOICE' },
  '1500134940724170884': { server: 'CONTRACTS-QS', name: 'paperclipforge-proc-001-qs', agent: 'PaperclipForge AI', purpose: 'PROC-001' },
  '1500134942770725036': { server: 'CONTRACTS-QS', name: 'measureforge-qs-voice', agent: 'MeasureForge AI', purpose: 'QS-VOICE' },

  // MEASUREMENT (1500131294879809696)
  '1500135012975120576': { server: 'MEASUREMENT', name: 'measureforge-measure-ai', agent: 'MeasureForge AI', purpose: 'MEASURE-AI' },
  '1500135015655411895': { server: 'MEASUREMENT', name: 'knowledgeforge-measure-analytics', agent: 'KnowledgeForge AI', purpose: 'MEASURE-ANALYTICS' },
  '1500135018000023795': { server: 'MEASUREMENT', name: 'measureforge-measure-cad', agent: 'MeasureForge AI', purpose: 'MEASURE-CAD' },
  '1500135020684247172': { server: 'MEASUREMENT', name: 'measureforge-measure-comm', agent: 'MeasureForge AI', purpose: 'MEASURE-COMM' },
  '1500135023146172477': { server: 'MEASUREMENT', name: 'measureforge-measure-templates', agent: 'MeasureForge AI', purpose: 'MEASURE-TEMPLATES' },
  '1500135025512026183': { server: 'MEASUREMENT', name: 'measureforge-measure-tender', agent: 'MeasureForge AI', purpose: 'MEASURE-TENDER' },

  // LOGIS-TEST (1500131631833288926)
  '1500135074379857920': { server: 'LOGIS-TEST', name: 'devforge-logis-test-foundation', agent: 'DevForge AI', purpose: 'LOGIS-TEST-001' },
  '1500135079224279042': { server: 'LOGIS-TEST', name: 'infraforge-logis-test-database', agent: 'InfraForge AI', purpose: 'LOGIS-TEST-002' },
  '1500135082005106749': { server: 'LOGIS-TEST', name: 'devforge-logis-test-agents', agent: 'DevForge AI', purpose: 'LOGIS-TEST-003' },
  '1500135085402493039': { server: 'LOGIS-TEST', name: 'devforge-logis-test-upserts', agent: 'DevForge AI', purpose: 'LOGIS-TEST-004' },
  '1500135089202397296': { server: 'LOGIS-TEST', name: 'devforge-logis-test-workspace', agent: 'DevForge AI', purpose: 'LOGIS-TEST-005' },
  '1500135091379372155': { server: 'LOGIS-TEST', name: 'devforge-logis-test-chatbot', agent: 'DevForge AI', purpose: 'LOGIS-TEST-006' },
  '1500135093149110362': { server: 'LOGIS-TEST', name: 'domainforge-logis-test-workflow', agent: 'DomainForge AI', purpose: 'LOGIS-TEST-007' },
  '1500135095133012078': { server: 'LOGIS-TEST', name: 'domainforge-logis-test-templates', agent: 'DomainForge AI', purpose: 'LOGIS-TEST-008' },
  '1500135097301467219': { server: 'LOGIS-TEST', name: 'domainforge-logis-test-suppliers', agent: 'DomainForge AI', purpose: 'LOGIS-TEST-009' },
  '1500135099683963001': { server: 'LOGIS-TEST', name: 'domainforge-logis-test-tenders', agent: 'DomainForge AI', purpose: 'LOGIS-TEST-010' },
  '1500135101210824897': { server: 'LOGIS-TEST', name: 'infraforge-logis-test-integrations', agent: 'InfraForge AI', purpose: 'LOGIS-TEST-011' },
  '1500135103358042384': { server: 'LOGIS-TEST', name: 'devforge-logis-test-compliance', agent: 'DevForge AI', purpose: 'LOGIS-TEST-012' },
  '1500135105568571425': { server: 'LOGIS-TEST', name: 'devforge-logis-test-delegation', agent: 'DevForge AI', purpose: 'LOGIS-TEST-013' },
  '1500135107871248457': { server: 'LOGIS-TEST', name: 'devforge-logis-test-feedback', agent: 'DevForge AI', purpose: 'LOGIS-TEST-014' },
  '1500135110450745466': { server: 'LOGIS-TEST', name: 'devforge-logis-test-signoff', agent: 'DevForge AI', purpose: 'LOGIS-TEST-015' },
  '1500135112447365241': { server: 'LOGIS-TEST', name: 'qualityforge-logis-test-regression', agent: 'QualityForge AI', purpose: 'LOGIS-TEST-016' },

  // LOGISTICS (1500131961761566851)
  '1500135153278648480': { server: 'LOGISTICS', name: 'voiceforge-log-voice', agent: 'VoiceForge AI', purpose: 'LOG-VOICE' },
  '1500135155694567457': { server: 'LOGISTICS', name: 'devforge-logistics-platform', agent: 'DevForge AI', purpose: 'LOGISTICS-PLATFORM' },

  // ENGINEERING (1500132315949699177)
  '1500135158739898399': { server: 'ENGINEERING', name: 'paperclipforge-eng-auto', agent: 'PaperclipForge AI', purpose: 'ENG-AUTO-000' },
  '1500135161302351922': { server: 'ENGINEERING', name: 'devforge-eng-platform', agent: 'DevForge AI', purpose: 'ENG-PLATFORM-000' },
  '1500135162804043838': { server: 'ENGINEERING', name: 'voiceforge-eng-voice', agent: 'VoiceForge AI', purpose: 'ENG-VOICE' },

  // ALL-DISCIPLINES (1500134557649731634)
  '1500135909285433435': { server: 'ALL-DISCIPLINES', name: 'domainforge-design-workflow', agent: 'DomainForge AI', purpose: 'DESIGN-WORKFLOW' },
  '1500135911361347727': { server: 'ALL-DISCIPLINES', name: 'voiceforge-arch-voice', agent: 'VoiceForge AI', purpose: 'ARCH-VOICE' },
  '1500135913219424421': { server: 'ALL-DISCIPLINES', name: 'domainforge-architectural-workflow', agent: 'DomainForge AI', purpose: 'ARCHITECTURAL-WORKFLOW' },
  '1500135915295608933': { server: 'ALL-DISCIPLINES', name: 'voiceforge-chem-voice', agent: 'VoiceForge AI', purpose: 'CHEM-VOICE' },
  '1500135917741150389': { server: 'ALL-DISCIPLINES', name: 'domainforge-chemical-workflow', agent: 'DomainForge AI', purpose: 'CHEMICAL-WORKFLOW' },
  '1500135919536181289': { server: 'ALL-DISCIPLINES', name: 'voiceforge-civil-voice', agent: 'VoiceForge AI', purpose: 'CIVIL-VOICE' },
  '1500135922057089044': { server: 'ALL-DISCIPLINES', name: 'domainforge-civil-workflow', agent: 'DomainForge AI', purpose: 'CIVIL-WORKFLOW' },
  '1500135924158173255': { server: 'ALL-DISCIPLINES', name: 'voiceforge-land-voice', agent: 'VoiceForge AI', purpose: 'LAND-VOICE' },
  '1500135925894877226': { server: 'ALL-DISCIPLINES', name: 'domainforge-geotech-workflow', agent: 'DomainForge AI', purpose: 'GEOTECH-WORKFLOW' },
  '1500135928377770166': { server: 'ALL-DISCIPLINES', name: 'voiceforge-geo-voice', agent: 'VoiceForge AI', purpose: 'GEO-VOICE' },
  '1500135930340839484': { server: 'ALL-DISCIPLINES', name: 'voiceforge-mech-voice', agent: 'VoiceForge AI', purpose: 'MECH-VOICE' },
  '1500135932349907115': { server: 'ALL-DISCIPLINES', name: 'domainforge-mech-workflow', agent: 'DomainForge AI', purpose: 'MECH-WORKFLOW' },
  '1500135934476288020': { server: 'ALL-DISCIPLINES', name: 'voiceforge-proce-voice', agent: 'VoiceForge AI', purpose: 'PROCE-VOICE' },
  '1500135936967573729': { server: 'ALL-DISCIPLINES', name: 'domainforge-process-workflow', agent: 'DomainForge AI', purpose: 'PROCESS-WORKFLOW' },
  '1500135939488612503': { server: 'ALL-DISCIPLINES', name: 'voiceforge-struc-voice', agent: 'VoiceForge AI', purpose: 'STRUC-VOICE' },
  '1500135941728112660': { server: 'ALL-DISCIPLINES', name: 'domainforge-env-workflow', agent: 'DomainForge AI', purpose: 'ENV-WORKFLOW' },
  '1500135943808614520': { server: 'ALL-DISCIPLINES', name: 'voiceforge-env-voice', agent: 'VoiceForge AI', purpose: 'ENV-VOICE' },
  '1500135945620684811': { server: 'ALL-DISCIPLINES', name: 'integrateforge-integration-settings', agent: 'IntegrateForge AI', purpose: 'INTEGRATION-SETTINGS-UI' },
  '1500135947667374144': { server: 'ALL-DISCIPLINES', name: 'devforge-security-asset', agent: 'DevForge AI', purpose: 'SECURITY-ASSET' },
  '1500135950422904852': { server: 'ALL-DISCIPLINES', name: 'domainforge-sundry-workflow', agent: 'DomainForge AI', purpose: 'SUNDRY-WORKFLOW' },
  '1500135953304653944': { server: 'ALL-DISCIPLINES', name: 'saasforge-saas-prod-prep', agent: 'SaaSForge AI', purpose: 'SAAS-PROD-PREP' },
  '1500135955460395252': { server: 'ALL-DISCIPLINES', name: 'mobileforge-mobile-test', agent: 'MobileForge AI', purpose: 'MOBILE-TEST' },
  '1500135958111064154': { server: 'ALL-DISCIPLINES', name: 'qualityforge-prod-test', agent: 'QualityForge AI', purpose: 'PROD-TEST' }
};

// ============================================================
// BOT READY
// ============================================================
client.once(Events.ClientReady, (c) => {
  console.log(`✅ OpenClaw Bot logged in as ${c.user.tag}`);
  const agentChannels = Object.values(CHANNEL_MAP).filter(c => c.agent !== null).length;
  console.log(`📋 ${Object.keys(CHANNEL_MAP).length} channels monitored (${agentChannels} with agent assignments)`);
});

// ============================================================
// MESSAGE HANDLER — Every channel is a conversation
// ============================================================
client.on(Events.MessageCreate, async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  const channelInfo = CHANNEL_MAP[message.channelId];

  // If this is a known agent channel, handle the message
  if (channelInfo && channelInfo.agent) {
    // Human posted in an agent's channel — forward to agent
    console.log(`📩 [${channelInfo.server}/#${channelInfo.name}] ${message.author.username}: ${message.content.substring(0, 100)}`);

    // Acknowledge in the same channel
    await message.reply(`📨 **${channelInfo.agent}** received your message for **${channelInfo.purpose}**. Processing...`);

    // TEST: Simulate agent response for ELEC-TEST foundation channel
    if (message.channelId === '1500118034470404136') {
      // Simulate DevForge AI processing delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      await message.channel.send(
        `🤖 **DevForge AI** (ELEC-TEST-001) response:\n\n` +
        `> "${message.content}"\n\n` +
        `✅ **Analysis complete.** I've processed your request for the electrical engineering foundation test. ` +
        `The test environment is configured and ready. Here's what I found:\n\n` +
        `• **Status:** All systems nominal\n` +
        `• **Test ID:** ELEC-TEST-001-${Date.now().toString(36)}\n` +
        `• **Next steps:** Review the foundation parameters and proceed with validation\n\n` +
        `*This is a simulated agent response for testing purposes.*`
      );
      return;
    }

    // TODO: Forward to OpenClaw agent runtime
    // When the agent runtime is integrated, this is where we:
    // 1. POST the message to the agent's task queue
    // 2. The agent processes and responds
    // 3. The bot posts the response back in this channel
    return;
  }

  // Handle commands in #agent-commands on Openclaw-comms
  if (message.channelId === '1499729515088314429') {
    const args = message.content.split(' ');
    const command = args[0].toLowerCase();

    switch (command) {
      case '!ping':
        await message.reply('🏓 Pong! Bot is online.');
        break;

      case '!status':
        const guilds = client.guilds.cache;
        let status = '🟢 **OpenClaw Bot Status**\n\n';
        status += `**Servers (${guilds.size}):**\n`;
        guilds.forEach(g => {
          const agentCh = Object.values(CHANNEL_MAP).filter(c => c.server === g.name && c.agent !== null).length;
          status += `  • **${g.name}** — ${agentCh} agent channels\n`;
        });
        status += `\n**Total agent channels:** ${Object.values(CHANNEL_MAP).filter(c => c.agent !== null).length}`;
        await message.reply(status);
        break;

      case '!help':
        await message.reply(
          '**OpenClaw Bot — How It Works**\n\n' +
          '**For humans:** Just type in any channel. The bot forwards your message to the assigned agent.\n' +
          '**For agents:** Reply in the same channel. Humans see your response immediately.\n\n' +
          '**Commands:**\n' +
          '`!ping` - Check bot is alive\n' +
          '`!status` - Show all servers and agent channels\n' +
          '`!help` - Show this help\n' +
          '`!channels` - List all channels with agent assignments\n' +
          '`!whoami` - Show which agent this channel is assigned to'
        );
        break;

      case '!channels':
        let reply = '**All Agent Channels:**\n';
        for (const [id, info] of Object.entries(CHANNEL_MAP)) {
          if (info.agent) {
            reply += `  • **${info.server}/#${info.name}** → ${info.agent} (${info.purpose})\n`;
          }
        }
        await message.reply(reply);
        break;

      case '!whoami':
        const thisChannel = CHANNEL_MAP[message.channelId];
        if (thisChannel && thisChannel.agent) {
          await message.reply(`This channel is assigned to **${thisChannel.agent}** for **${thisChannel.purpose}**.`);
        } else {
          await message.reply('This channel is not assigned to any specific agent.');
        }
        break;

      default:
        if (command.startsWith('!')) {
          await message.reply(`Unknown command: ${command}. Try \`!help\``);
        }
    }
  }
});

// ============================================================
// LOGIN
// ============================================================
client.login(process.env.DISCORD_BOT_TOKEN)
  .then(() => console.log('🔑 Bot authenticated successfully'))
  .catch(err => {
    console.error('❌ Bot authentication failed:', err.message);
    process.exit(1);
  });