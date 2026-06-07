# GBA Scenarios Platform — Extracted Data (2026-06-05)

> Source: https://www.gba-scenarios.cn/ (粤港澳大湾区应用场景发布厅)
> Status: 公测阶段 (Public Beta)
> Builder: 优网科技 (uweb.net.cn), Copyright 2014-2025
> Mission: 推动先进技术与应用场景深度融合，助力粤港澳大湾区高质量发展

## Site Architecture

```
首页 (/)
├── 场景服务矩阵 (/hezuoshengtai.html)
│   └── 中心网络 (/hezuoshengtai/zhongxinwangluo.html)
├── 超级场景 (/chaojichangjing.html)
│   ├── 海陆空全空间无人体系超级场景
│   ├── 深海资源商业化开发体系超级场景
│   ├── 现代种业创新体系超级场景
│   └── 人工智能与机器人示范场景
├── 场景对接 (/changjingduijie.html)
│   ├── 活动报名 (/changjingduijie/huodongbaoming.html)
│   ├── 场景机会 (/changjingduijie/changjingjihui.html)
│   ├── 场景能力 (/changjingduijie/changjingnengli.html)
│   └── 虚拟展厅 (/changjingduijie/xunizhanting.html)
├── 场景政策包 (/changjingzhengcebao.html)
├── 场景资讯 (/wanqufengcai.html)
│   ├── 场景创新展示平台
│   ├── 场景案例 (/wanqufengcai/changjinganli.html)
│   ├── 场景活动 (/wanqufengcai/changjinghuodong.html)
│   └── 前沿动态 (/wanqufengcai/changjingzixun.html)
└── 关于我们 (/guanyuwomen.html)
```

## Scale

- 场景机会: **143** (commented out in HTML)
- 场景能力: **33** (commented out in HTML)
- 4 Super Scenarios
- 16+ events (2024.05 - 2026.04)

## Super Scenarios Detail

1. **海陆空全空间无人体系** — Backed by 国家三部委《关于支持广州南沙放宽市场准入与加强监管体制改革的意见》
2. **深海资源商业化开发体系** — Key infrastructure: "梦想"号钻探船, "冷泉生态系统研究装置", "瞭越"号科考船
3. **现代种业创新体系** — 国家三部委"全面提升种业行业准入效能"部署
4. **人工智能与机器人示范场景** — Based at 深圳龙岗大运中心

## Event Series

Brand: **"岭航场景·粤进未来"** (and "湾有引力·创享其成")
Coverage: 具身智能, 全空间无人体系, 北斗, 医疗器械/生物医药, 智能制造, 绿色能源, 低空经济, 智能算力, 新能源/储能, AI/机器人, 制造业
Locations: 广州南沙, 深圳龙岗, 佛山顺德, 东莞松山湖, 潮州, 香港

## Scenario Opportunity Domains (from 40 sampled items)

| Domain | Count | Examples |
|--------|-------|----------|
| AI/Robotics | 12 | 具身智能巡检机器人, 校园AI智能体, 政务AI数智员工 |
| Healthcare | 8 | AI手术质控, 术后康复, 医院BI+AI决策 |
| Low-altitude Economy | 5 | 无人机血液运输, 低空巡检应急 |
| Education | 5 | 基础教育AI赋能, 数字化建设, AI课程 |
| Smart City/Gov | 4 | AI监测预警, 水旱灾害防御, 智慧水务 |
| Manufacturing | 4 | AI视觉检测, MES, 智能转运 |
| Energy | 2 | 光储充能源管理, 空调能效提升 |

## Scenario Capability Domains (from 30 sampled items)

| Domain | Count | Examples |
|--------|-------|----------|
| Low-altitude/Drones | 7 | CAAC培训, 六位一体服务, 科普研学 |
| Medical AI | 6 | 医技智能体, 数智超声大模型, 眼科大模型 |
| Smart Manufacturing | 5 | 机器视觉检测, 陶瓷全要素管理, 智能卫浴 |
| New Materials | 2 | 真空等离子体传感器, 阻燃聚酯薄膜 |
| Cybersecurity | 1 | 新一代AI安全解决方案 |

## Technical Stack

- Frontend: jQuery + custom CSS/JS
- Backend: PHP (推断, from CMS pattern)
- CMS: Shopro variant (from `/assets/static/shopro/common.js`)
- CAPTCHA: Tencent Cloud TCaptcha
- Search: Built-in CMS search
