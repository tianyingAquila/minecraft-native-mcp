# Minecraft 直播扩展（可选）

先安装 Minecraft Native MCP 基础版。此包只增加“直播扩展”入口，启用游戏内鲸鱼、气泡、余额提示和直播绑定说明；不替代基础版，不接收直播评论。

安装：`dsh plugin --profile desktop add https://github.com/tianyingAquila/minecraft-native-mcp/releases/latest/download/dsh-minecraft-stream.tgz`，重新打开DSH。暂停游戏后，点Minecraft旁的“直播扩展”，控制台会显示直播选项。普通游玩无需安装此包。

抖音直播伴侣中添加“游戏进程”，选当前Minecraft Java进程，按画布比例缩放；鲸鱼与气泡已经在游戏画面中，不必再叠绿幕。需要单独网页挂件时，用控制台的绿幕链接添加窗口捕获、裁剪标题栏并使用绿幕抠像；部分设备会在网页完全遮挡时停止刷新，优先使用游戏内绘制。推流和结束推流由直播伴侣单独操作。

其他直播软件只提供同一游戏画面及挂件数据，具体窗口绑定请自行适配。不要混用两个鲸鱼素材源。

返回普通游玩：暂停后在控制台点“关闭直播扩展”。卸载前也先关闭扩展，然后运行 `dsh plugin --profile desktop remove dsh-minecraft-stream`；保留基础版及存档。
