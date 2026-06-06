#!/usr/bin/env node
/**
 * 廉政档案查询 CLI - DEMO 版
 * 用真实接口时只需替换 fetchFromOA 里的 fetch 调用
 *
 * 用法:
 *   node oa-integrity.js profile  EMP001
 *   node oa-integrity.js violations EMP001
 *   node oa-integrity.js trainings  EMP001
 *   node oa-integrity.js pledges    EMP001
 *   node oa-integrity.js reports    EMP001
 *   node oa-integrity.js submissions [部门]              # 查询述职述廉报告提交情况
 */

const [,, cmd, employeeId] = process.argv;
const { fetchFromOA } = require('./oa-integrity-service.js');

if (!cmd) {
  console.error('用法: oa-integrity <profile|violations|trainings|pledges|reports|submissions> [参数]');
  process.exit(1);
}

if (!employeeId && cmd !== 'submissions') {
  console.error('用法: oa-integrity <profile|violations|trainings|pledges|reports> <员工ID>');
  process.exit(1);
}

async function main() {
  const endpoint = cmd === 'submissions'
    ? employeeId
      ? `/integrity/employees/${employeeId}/submissions`
      : '/integrity/employees/submissions'
    : `/integrity/employees/${employeeId}/${cmd}`;

  const data = await fetchFromOA(endpoint);
  console.log(JSON.stringify(data, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
