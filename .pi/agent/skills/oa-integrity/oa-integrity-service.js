#!/usr/bin/env node
/**
 * oa-integrity-service.js
 *
 * 提供 fetchFromOA(endpoint) 函数，用于响应
 *   const data = await fetchFromOA(`/integrity/employees/${employeeId}/${cmd}`);
 *
 * 支持真实 OA 接口调用，也支持随机模拟数据返回。
 */

const SUPPORTED_COMMANDS = new Set(['profile', 'violations', 'trainings', 'pledges', 'reports', 'submissions']);

const EMPLOYEE_REGISTRY = new Map([
  ['EMP001', '王琼'],
  ['EMP002', '张伟'],
  ['EMP003', '李娜'],
  ['EMP004', '陈涛'],
  ['EMP005', '刘敏'],
]);

const NAME_TO_EMPLOYEE_ID = new Map(Array.from(EMPLOYEE_REGISTRY.entries()).map(([id, name]) => [name, id]));

function createSeededRandom(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 0x100000000;
  };
}

function sample(random, items) {
  const index = Math.floor(random() * items.length);
  return items[index < items.length ? index : items.length - 1];
}

function randomInt(random, min, max) {
  return Math.floor(random() * (max - min + 1)) + min;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function randomDateBetween(random, start, end) {
  const startMs = start.getTime();
  const endMs = end.getTime();
  return new Date(startMs + random() * (endMs - startMs));
}

function generateName(random) {
  const surnames = ['张', '王', '李', '刘', '陈', '杨', '赵', '黄', '吴', '周'];
  const names = ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '洋', '艳', '红', '军', '杰', '琼', '霞'];
  return sample(random, surnames) + sample(random, names) + (random() < 0.4 ? sample(random, names) : '');
}

function parseEndpoint(endpoint) {
  let match = /^\/integrity\/employees\/([^\/]+)\/([^\/]+)$/.exec(endpoint);
  if (match) {
    const employeeId = decodeURIComponent(match[1]);
    const cmd = match[2];
    if (!SUPPORTED_COMMANDS.has(cmd)) {
      throw new Error(`不支持的命令：${cmd}`);
    }
    return { employeeId, cmd };
  }

  match = /^\/integrity\/employees\/([^\/]+)$/.exec(endpoint);
  if (match) {
    const cmd = match[1];
    if (cmd !== 'submissions') {
      throw new Error(`endpoint 格式错误，期望 /integrity/employees/{employeeId}/{cmd}，实际为：${endpoint}`);
    }
    return { employeeId: undefined, cmd };
  }

  throw new Error(`endpoint 格式错误，期望 /integrity/employees/{employeeId}/{cmd} 或 /integrity/employees/submissions，实际为：${endpoint}`);
}

function normalizeEmployeeIdentifier(identifier) {
  if (!identifier) {
    return { employeeId: undefined, employeeName: undefined };
  }

  if (EMPLOYEE_REGISTRY.has(identifier)) {
    return { employeeId: identifier, employeeName: EMPLOYEE_REGISTRY.get(identifier) };
  }

  if (NAME_TO_EMPLOYEE_ID.has(identifier)) {
    return { employeeId: NAME_TO_EMPLOYEE_ID.get(identifier), employeeName: identifier };
  }

  if (/^[\u4e00-\u9fa5]+$/.test(identifier)) {
    return { employeeId: identifier, employeeName: identifier };
  }

  return { employeeId: identifier, employeeName: EMPLOYEE_REGISTRY.get(identifier) ?? identifier };
}

function generateProfile(employeeId, name, random) {
  const departments = ['财务部', '审计部', '人力资源部', '采购部', '法务部', '行政部'];
  const positions = ['会计', '审计员', '人事专员', '采购专员', '法律顾问', '行政助理'];
  const levels = ['优秀', '良好', '一般', '待改进'];
  const reviewDate = randomDateBetween(random, new Date('2025-01-01'), new Date());
  const department = sample(random, departments);
  const position = sample(random, positions);
  const integrityLevel = sample(random, levels);

  return {
    employeeId,
    name,
    department,
    position,
    integrityLevel,
    lastReviewDate: formatDate(reviewDate),
    profileInfo: generateProfileInfo(employeeId, name, department, position, integrityLevel, random),
  };
}

function generateProfileInfo(employeeId, name, department, position, integrityLevel, random) {
  const starts = [
    `${name}（员工号：${employeeId}）目前在${department}担任${position}。`,
    `作为${department}中的${position}，${name}在日常工作中表现出高度的责任感。`,
    `${name}，员工号${employeeId}，现任${department}的${position}，已有多年岗位经验。`,
  ];
  const strengths = [
    '他/她在制度执行、风险识别方面尤为细致，能够及时发现异常线索。',
    '其工作态度严谨，善于将复杂合规要求落地为实操方案。',
    '对廉洁从业教育有较高的敏感度，能够主动落实培训与整改建议。',
    '面对同事的违规行为，他/她会坚持原则、及时汇报，不回避冲突。',
  ];
  const history = [
    '过去一年中，参与了多次内部审计与廉政风险评估。',
    '在年度考核中，他/她多次获得“合规表现良好”评价。',
    '曾负责牵头落实供应商廉洁保障措施，并推动部门间协同。',
    '参与过公司反腐倡廉专题会议，并在会后整理成文档供部门复盘使用。',
  ];
  const development = [
    '为进一步提升工作能力，积极参加了合规与风险管理培训。',
    '他/她在业务推进中兼顾效率与规范，不仅注重结果，也关注过程记录。',
    '在部门内部，他/她经常分享廉洁从业案例，推动同事共同提高自查意识。',
    '对制度细节的理解深入，能够将公司要求转化为可执行工作要点。',
  ];
  const future = [
    '后续仍需继续加强对复杂业务场景中的风险识别与防控。',
    '希望在未来一年进一步推动部门廉洁评估标准化。',
    '建议继续关注重点人员的变动与利益冲突风险。',
    '未来可在信息化合规管理方面贡献更多经验和建议。',
  ];

  const sentences = [
    sample(random, starts),
    sample(random, strengths),
    sample(random, history),
    sample(random, development),
    sample(random, future),
  ];

  let text = sentences.join(' ');
  while (text.length < 520) {
    text += ' ' + sample(random, [...strengths, ...history, ...development, ...future]);
  }

  return text;
}

function generateViolations(random) {
  const types = ['违规报销', '利益冲突', '收受礼品礼金', '违反请假制度', '信息泄露'];
  const severities = ['轻微', '一般', '严重'];
  const statuses = ['已处理', '处理中', '待审核'];
  const count = randomInt(random, 0, 3);
  const violations = [];

  for (let i = 0; i < count; i += 1) {
    violations.push({
      date: formatDate(randomDateBetween(random, new Date('2024-01-01'), new Date())),
      type: sample(random, types),
      severity: sample(random, severities),
      status: sample(random, statuses),
    });
  }

  return violations;
}

function generateTrainings(random) {
  const courses = ['廉洁从业教育', '反腐倡廉专题培训', '安全生产与职业道德', '合规与风险管理'];
  const results = ['通过', '未通过', '缺席'];
  const count = randomInt(random, 1, 4);
  const trainings = [];

  for (let i = 0; i < count; i += 1) {
    trainings.push({
      date: formatDate(randomDateBetween(random, new Date('2024-01-01'), new Date())),
      course: sample(random, courses),
      hours: randomInt(random, 2, 8),
      result: sample(random, results),
    });
  }

  trainings.sort((a, b) => a.date.localeCompare(b.date));
  return trainings;
}

function generatePledges(random) {
  const currentYear = new Date().getFullYear();
  const count = randomInt(random, 1, 2);
  const pledges = [];

  for (let i = 0; i < count; i += 1) {
    const year = currentYear - i;
    pledges.push({
      year,
      title: '廉洁从业承诺书',
      signedDate: formatDate(randomDateBetween(random, new Date(`${year}-01-01`), new Date(`${year}-03-31`))),
      status: '已签署',
    });
  }

  return pledges;
}

function generateReports(random) {
  const categories = ['匿名举报', '线索举报', '投诉转报'];
  const statuses = ['已受理', '已归档', '待核实'];
  const count = randomInt(random, 0, 2);
  const reports = [];

  for (let i = 0; i < count; i += 1) {
    reports.push({
      date: formatDate(randomDateBetween(random, new Date('2024-01-01'), new Date())),
      category: sample(random, categories),
      summary: `${sample(random, ['涉嫌违规报销', '存在利益输送', '沟通不当'])}，需进一步核实。`,
      status: sample(random, statuses),
    });
  }

  return reports;
}

function generateSubmissions(random, departmentFilter) {
  const departments = ['财务部', '人事部', '采购部', '信息技术部', '市场部', '生产部'];
  const leaders = ['李四', '王五', '赵六', '孙七', '周八', '吴九'];
  const statuses = ['已提交', '未提交', '延期提交'];

  const rows = departments.map((department, index) => ({
    department,
    leader: leaders[index],
    submitDate: random() < 0.7 ? formatDate(randomDateBetween(random, new Date('2026-05-01'), new Date('2026-05-31'))) : '',
    status: random() < 0.7 ? '已提交' : '未提交',
  }));

  if (!departmentFilter) {
    return rows;
  }

  const filter = departmentFilter.toString();
  return rows.filter((item) => item.department.includes(filter));
}

function generateRandomData(cmd, employeeId, employeeName) {
  const random = createSeededRandom(`${employeeId || employeeName || 'all'}:${cmd}`);

  switch (cmd) {
    case 'profile':
      return generateProfile(employeeId, employeeName, random);
    case 'violations':
      return generateViolations(random);
    case 'trainings':
      return generateTrainings(random);
    case 'pledges':
      return generatePledges(random);
    case 'reports':
      return generateReports(random);
    case 'submissions':
      return generateSubmissions(random, employeeId);
    default:
      return {};
  }
}

async function fetchFromOA(endpoint) {
  const { employeeId: rawIdentifier, cmd } = parseEndpoint(endpoint);
  const { employeeId, employeeName } = normalizeEmployeeIdentifier(rawIdentifier);
  const baseUrl = process.env.OA_BASE_URL;
  const token = process.env.OA_TOKEN;

  if (!baseUrl || !token) {
    return generateRandomData(cmd, employeeId, employeeName);
  }

  const url = `${baseUrl.replace(/\/$/, '')}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`接口调用失败: ${response.status} ${response.statusText}\n${body}`);
  }

  return response.json();
}

if (require.main === module) {
  const [,, endpoint] = process.argv;
  if (!endpoint) {
    console.error('用法: node oa-integrity-service.js /integrity/employees/<employeeId>/<cmd>');
    process.exit(1);
  }

  fetchFromOA(endpoint)
    .then((data) => console.log(JSON.stringify(data, null, 2)))
    .catch((error) => {
      console.error(error.message || error);
      process.exit(1);
    });
}

module.exports = { fetchFromOA };
