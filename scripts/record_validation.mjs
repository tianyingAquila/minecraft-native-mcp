import fs from 'node:fs';
import path from 'node:path';
const matrix=JSON.parse(fs.readFileSync('versions.json')),helpers=JSON.parse(fs.readFileSync('artifacts/helpers/manifest.json'));
const rows=[],evidence=[];
for(const entry of matrix.versions){let proof;try{proof=JSON.parse(fs.readFileSync(path.join('outputs/smoke',entry.id,'report.json')));}catch{}
 if(proof)evidence.push({version:entry.id,passed:proof.passed,startedAt:proof.startedAt,finishedAt:proof.finishedAt,modelRequests:proof.modelRequests,checks:proof.steps.map(x=>x.step),containers:proof.steps.filter(x=>x.step==='native-container').map(x=>x.type),merchant:proof.steps.some(x=>x.step==='native-merchant')});
 entry.validation.compiled=Boolean(helpers.versions[entry.id]?.compiled);
 entry.validation.smoke=proof?Boolean(proof.passed):Boolean(entry.validation.smoke);
 entry.validation.nativeHud=proof?proof.passed&&proof.steps.some(x=>x.step==='native-hud'):Boolean(entry.validation.nativeHud);
 entry.validation.nativeContainers=Boolean(proof?.passed&&proof.steps.filter(x=>x.step==='native-container').length>=6);
 rows.push(`| ${entry.id} | ${entry.validation.compiled?'通过':'待验证'} | ${entry.validation.smoke?'通过':'待验证'} | ${entry.validation.nativeHud?'通过':'待验证'} | ${entry.validation.nativeContainers?'通过':'待专项验证'} |`);
}
fs.writeFileSync('docs/validation.json',JSON.stringify({platform:'Windows x64',scope:'Local isolated real-game smoke, not autonomous completion or clean-Windows installation',versions:evidence},null,2)+'\n');
fs.writeFileSync('versions.json',JSON.stringify(matrix,null,2)+'\n');
fs.writeFileSync('docs/compatibility.md',`# 兼容与验证\n\n支持目标为Windows x64、Minecraft Java1.21系列正式版、Java21。当前DSH本机验证版本为0.2.0-rc.2。每个游戏版本使用对应Fabric/MCP/Baritone与独立辅助模组，不以放宽版本检查冒充兼容。\n\n| Minecraft | 客户端/服务端编译 | 真实生存、挖掘、截图、效果与冻结 | 游戏内挂件/气泡 | 0.3.1通用容器专项 |\n|---|---|---|---|---|\n${rows.join('\n')}\n\n容器专项在标记版本实测熔炉、箱子、工作台、酿造台、铁砧和锻造台；其他版本已编译，专项启动状态单独列出。特殊按钮动作和自定义窗口并非全部已实现。\n\n[最小实机记录](validation.json)保留各版本时间、检查项和零模型请求计数。实机流程由scripts/smoke_game.mjs执行，使用独立的临时测试世界和受控方块，检查真实原生命令结果，不调用模型；它不代表AI已自主通关。游戏本体不随发布包分发。1.21使用经单独验证的上游1.21.1桥接兼容副本，仅调整Minecraft版本声明，原始文件和兼容副本分别校验。\n\n安装与界面验收包括：缺游戏错误及恢复、进度/取消、便携Java自动下载、DSH发布包依赖复用、桌面与手机布局。具体复现步骤见架构与开发说明。完整长局、所有电脑/网络组合、其他系统以及末影龙通关仍未验收。\n`);
console.log('Updated version evidence');
