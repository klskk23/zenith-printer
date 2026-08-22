# Specification Quality Checklist: Google Sheets 数据源

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-22
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

第一轮复核发现三处不合格，均已修正：

| 项 | 问题 | 处理 |
|---|---|---|
| 需求可测且无歧义 | FR-008 原文「展示……与前若干行」，「若干」无法验证 | 改为「全部列名与至少 3 行数据（不足 3 行时展示全部）」 |
| 无实现细节泄漏 | FR-033 原文含「通过与界面相同的服务接口执行，MUST NOT 直接改写存储」，这是实现约束 | 改为按行为表述：命令行与界面的刷新行为必须完全一致，不得有单侧独有的差异 |
| 成功标准与技术无关 | SC-007 原文「默认测试套件在断网环境下全部通过」，「测试套件」是实现产物 | 改为「在完全没有外部网络连接的环境下，本功能的全部行为仍可被完整验证」 |

有意为之的两处，供 `/speckit-clarify` 复核时不必重复提出：

- **规格里不出现「服务账号」**。`docs/google-sheets-data-source.md` 已论证选它并否决
  OAuth2，但那是 HOW。规格只约束 WHAT：FR-001 要求「由部署方配置的机器身份，不依赖任何
  个人用户的登录或授权」——这既表达了必须满足的性质，又把机制留给 `/speckit-plan`。
- ~~「链接的数据源默认叫什么名字」按合理默认处理~~ —— **已由 2026-08-22 的澄清取代**。
  当时的默认（取工作表名）与既有的名称唯一性约束冲突，且使「同一张表链接两次」这条边界
  情形无法成立；现改为在预览确认环节提供可编辑的名称框（FR-008a、FR-008b）。

外部事实提醒（不影响本清单，但影响 `/speckit-plan`）：共识文档第 1 节关于 Google 重定向
URI、刷新令牌有效期、敏感权限验证的陈述来自访谈时的既有知识，**制定计划前需对着当前官方
文档核实**，并确认在 Google 项目中启用 Sheets API。
