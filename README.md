# 会话考古 · Session Archaeology

一个 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）插件：**手动选中一段历史会话，离线蒸馏出可复用的 Skill。**

它不参与实时对话，也不调用模型。你挑一段会话，它只读那份**已提交的会话日志**，把当时真正跑通的步骤、踩过的坑和最后的验证，整理成一份带事件级证据的 `SKILL.md`，写进技能库。

## 特点

- **手动触发**：不点按钮什么都不发生。
- **完全离线**：纯规则蒸馏，零模型调用、零网络请求。
- **可回查**：每条结论都带 `(#seq)`，指向源会话的事件序号。
- **即插即用**：保存后立即出现在该 profile 所有会话的技能目录里。
- **中英双语**：界面与产出的 SKILL.md 都支持 `zh` / `en`。

## 安装

本插件是一个 DSH bundle（`package.json` 里声明了 `dsh.bundle.patch` 与 `dsh.client`），安装到某个 profile：

```text
# 在 DSH 会话里让 agent 执行，target 指向本目录的绝对路径
plugin_manager install_bundle <path-to>/session-archaeology
```

安装会写入该 profile 的 `package.json` 与 `cordis.patch.yml`，无需手工编辑。安装完成后刷新 DSH Web 页面，左侧边栏出现「会话考古」图标。

卸载：

```text
plugin_manager remove_bundle @local/dsh-session-archaeology
```

## 使用

1. 点左侧「会话考古」图标；
2. 在左栏选中一段历史会话；
3. 点「蒸馏 Skill」；
4. 检查、修改名称 / 描述 / 何时使用；
5. 点「保存到技能库」。

产物落在：

```
~/.dsh/session-archaeology/skills/<skill-name>/
├── SKILL.md    # 技能正文（YAML frontmatter + Markdown）
└── meta.json   # 统计与证据索引
```

插件通过 `ctx.skills` 注册了一个 provider 指向该目录，所以保存或删除后技能目录会立刻刷新。

## 蒸馏规则

| SKILL.md 章节 | 来自什么 | 判据 |
|---|---|---|
| 步骤 | 工具调用最密集的一轮对话 | 成功调用，按 seq 排序，去重，附当时的意图句 |
| 关键文件 | `write` / `edit` 的 `file_path` | 按命中次数排序 |
| 坑与修正 | 失败调用 → 同轮内下一次成功调用 | 失败原因取结果首行或错误字段 |
| 用户纠正 | 用户发言 | 「不对 / 应该 / 改成 / instead / actually…」 |
| 验证 | 命令命中 test/build/lint/run 等 | 且输出读起来像结果（success / passed / exit: 0） |

被用户纠正过的修正会额外标注「随后被用户纠正 #n」，避免把被推翻的做法当成结论。

## 文件结构

```
session-archaeology/
├── package.json        # bundle 清单：dsh.bundle.patch + dsh.client
├── cordis.patch.yml    # 把 Host 行插进 profile
├── index.js            # Host 半侧：HTTP 路由 + skills provider 装配
├── digest.js           # 离线蒸馏：会话日志 → SKILL.md 草稿（纯函数）
├── skill-store.js      # 技能库读写 + ctx.skills provider
├── client.js           # 浏览器半侧：侧边栏图标 + 中央页面
├── icon.svg            # 插件图标
└── locale/{zh,en}.json # 插件管理页的标题与描述
```

`digest.js` 不依赖 DSH 运行时，可以单独测试：输入是 `{ session, events }`，输出是 `{ name, description, whenToUse, body, stats, evidence }`。

## 已知限制

- **粒度是整段会话**，还不能只选其中某几轮；这是最自然的下一步扩展。
- 蒸馏是**启发式**的：它忠实记录「发生了什么」，但不解释「为什么」，也不会替你重写措辞。
- 仅在 **DSH Desktop / Windows** 上实测过；其他 profile 布局未验证。
- 递归 `install_bundle` 后需要刷新页面才能拿到新的 Client 模块。

## License

[MIT](LICENSE) © 2026 LittleGreyy
