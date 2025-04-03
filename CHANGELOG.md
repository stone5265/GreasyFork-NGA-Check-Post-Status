# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [0.1.0] - 2025-04-03

### Added

- 创建仓库, 上传用户脚本到Greasy Fork
- 功能1: 浏览主题的时候, 检查该页自己发布的"主题/回复"别人是否能看见, 并在(仅自己的回复)"点赞"按钮旁边显示检测结果, 若检测到不可见, 则会有一个消息弹窗进行提示
- 功能2: 在"点赞"按钮旁边添加一个"关注"按钮, 可以将该楼层添加进"关注列表"
- 功能3(默认关闭): 当处于帖子列表页时, 自动检查关注列表中未失效的关注, 若检测到关注列表中有不可见楼层, 则会有一个消息弹窗进行提示
- 关注列表
  - 主题: 楼层所在的主题名字
  - 楼层: 点击楼层可跳转到该楼层
  - 状态: `可见` / `不可见` / `-`(未检查)
  - 上次检测: 上一次对该楼层进行的可见性检查的时间
  - 剩余天数: 距离该关注失效的剩余天数
  - 操作: 重置(重置剩余时间为设置的"关注过期天数") / 永久(将剩余时间设置为永不过期) / 检查(检查该楼层是否可见) / 删除(取消对该楼层的关注)

## [0.1.1] - 2025-04-03

### Changed

- 修复关注列表的某个样式

## [0.1.2] - 2025-04-03

### Changed

- 修复自动检查**致命BUG**