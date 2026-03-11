const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { sendSuccess } = require('../utils/response');
const { asyncHandler } = require('../utils/async-handler');
const { HttpError } = require('../utils/http-error');
const { pickText, toArray, shrink } = require('../utils/text');

const LOCAL_SKILLS_DIR = '/home/openclaw/skills';

function taskStatusToSkillStatus(task) {
  if (!task) return 'unknown';
  if (task.status === 'pending' || task.status === 'running') return 'running';
  if (task.status === 'failed') return 'error';
  if (task.status === 'success') return 'ok';
  return 'unknown';
}

function normalizeSkillKey(text) {
  return pickText(text).trim().toLowerCase();
}

function parseSkillNameFromMarkdown(markdown) {
  const raw = String(markdown || '');
  if (!raw.trim()) return '';

  const frontMatterMatch = raw.match(/^---\s*[\r\n]+([\s\S]*?)\r?\n---/);
  const inspectScope = frontMatterMatch ? frontMatterMatch[1] : raw.slice(0, 320);
  const nameMatch = inspectScope.match(/^\s*name\s*:\s*([^\n#]+?)\s*$/im);
  if (!nameMatch) return '';

  return pickText(nameMatch[1]).replace(/^['"]|['"]$/g, '');
}

async function resolveCanonicalSkillName(slug) {
  const safeSlug = pickText(slug);
  if (!safeSlug) return '';

  const skillMd = path.join(LOCAL_SKILLS_DIR, safeSlug, 'SKILL.md');
  try {
    const raw = await fs.readFile(skillMd, 'utf8');
    return parseSkillNameFromMarkdown(raw);
  } catch {
    return '';
  }
}

function buildRuntimeSkillIndex(availableSkills = []) {
  const map = new Map();
  toArray(availableSkills).forEach((skill) => {
    const key = normalizeSkillKey(skill?.name);
    if (!key) return;
    if (!map.has(key)) map.set(key, skill);
  });
  return map;
}

function summarizeRuntimeMissing(missing = {}) {
  const parts = [];
  const bins = toArray(missing.bins);
  const env = toArray(missing.env);
  const config = toArray(missing.config);
  const os = toArray(missing.os);

  if (bins.length) parts.push(`缺少命令: ${bins.slice(0, 3).join(', ')}`);
  if (env.length) parts.push(`缺少环境变量: ${env.slice(0, 3).join(', ')}`);
  if (config.length) parts.push(`缺少配置: ${config.slice(0, 3).join(', ')}`);
  if (os.length) parts.push(`系统限制: ${os.join(', ')}`);

  return parts.join('；');
}

function runtimeToSkillState(runtimeSkill) {
  if (!runtimeSkill) {
    return {
      status: 'unknown',
      reason: '未匹配到运行时技能信息'
    };
  }

  if (runtimeSkill.disabled) {
    return {
      status: 'error',
      reason: '技能已被禁用'
    };
  }

  if (runtimeSkill.blockedByAllowlist) {
    return {
      status: 'error',
      reason: '技能被 allowlist 拦截'
    };
  }

  if (runtimeSkill.eligible) {
    return {
      status: 'ok',
      reason: '运行条件满足'
    };
  }

  const missingSummary = summarizeRuntimeMissing(runtimeSkill.missing || {});
  return {
    status: 'error',
    reason: missingSummary || '运行条件未满足'
  };
}

function resolveRuntimeSkill(runtimeIndex, slug, canonicalName) {
  const keys = [];
  const slugKey = normalizeSkillKey(slug);
  const canonicalKey = normalizeSkillKey(canonicalName);

  if (slugKey) keys.push(slugKey);
  if (canonicalKey && canonicalKey !== slugKey) keys.push(canonicalKey);

  if (slugKey.endsWith('-search')) {
    keys.push(slugKey.replace(/-search$/i, ''));
  }

  for (const key of keys) {
    if (runtimeIndex.has(key)) return runtimeIndex.get(key);
  }

  return null;
}

async function decorateSkills(skills, taskMap, availableSkills = []) {
  const runtimeIndex = buildRuntimeSkillIndex(availableSkills);

  const rows = await Promise.all(
    toArray(skills).map(async (skill) => {
      const slug = pickText(skill.slug);
      const task = taskMap.get(slug);
      const taskStatus = taskStatusToSkillStatus(task);

      const canonicalName = await resolveCanonicalSkillName(slug);
      const runtimeSkill = resolveRuntimeSkill(runtimeIndex, slug, canonicalName);
      const runtimeState = runtimeToSkillState(runtimeSkill);

      let status = runtimeState.status;
      if (taskStatus === 'running') status = 'running';
      if (task?.status === 'failed') status = 'error';
      if (task?.status === 'success' && status === 'unknown') status = 'ok';

      const recentResult = pickText(task?.error, task?.message, runtimeState.reason);
      const updatedAt = pickText(task?.endedAt, task?.createdAt);

      return {
        slug,
        canonicalName: pickText(canonicalName, runtimeSkill?.name),
        version: pickText(skill.version) || '-',
        source: pickText(runtimeSkill?.source, 'clawhub'),
        status,
        updatedAt,
        recentResult,
        taskId: pickText(task?.id),
        runtimeEligible: Boolean(runtimeSkill?.eligible),
        runtimeBlocked: Boolean(runtimeSkill?.blockedByAllowlist),
        runtimeDisabled: Boolean(runtimeSkill?.disabled),
        runtimeMissing: runtimeSkill?.missing || null
      };
    })
  );

  return rows;
}

function createSkillsRouter({ openclawService, taskService }) {
  const router = express.Router();


  router.get(
    '/search-links',
    asyncHandler(async (req, res) => {
      const query = pickText(req.query.q);
      const links = openclawService.buildSkillSearchLinks(query);
      return sendSuccess(res, {
        query,
        links
      });
    })
  );

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const rawList = await openclawService.listSkillsRaw();
      const taskMap = await taskService.getLatestTaskMapByTarget(['skills.']);
      const available = await openclawService.listAvailableSkills().catch(() => ({ skills: [] }));
      let skills = await decorateSkills(rawList.rows, taskMap, available.skills);

      const query = pickText(req.query.q).toLowerCase();
      const statusFilter = pickText(req.query.status).toLowerCase();

      if (query) {
        skills = skills.filter((row) => row.slug.toLowerCase().includes(query));
      }
      if (statusFilter && statusFilter !== 'all') {
        skills = skills.filter((row) => row.status.toLowerCase() === statusFilter);
      }

      return sendSuccess(
        res,
        {
          skills,
          total: rawList.rows.length,
          filtered: skills.length,
          raw: rawList.raw
        },
        {
          legacy: {
            skills,
            raw: rawList.raw
          }
        }
      );
    })
  );


  router.post(
    '/install-zip',
    asyncHandler(async (req, res) => {
      const fileName = pickText(req.body?.fileName);
      const zipBase64 = pickText(req.body?.zipBase64);
      if (!fileName || !zipBase64) {
        throw new HttpError(400, 'INVALID_SKILL_ZIP', 'fileName and zipBase64 are required');
      }

      const output = await taskService.runTask({
        type: 'skills.install-zip',
        target: fileName,
        message: `Install skill zip ${fileName}`,
        action: async () => {
          const result = await openclawService.installSkillFromZip(fileName, zipBase64);
          return {
            slug: result.slug,
            text: result.text,
            installPath: result.installPath,
            backupPath: result.backupPath,
            reloadMessage: result.reloadMessage,
            message: shrink(pickText(result.text, `Installed from zip: ${fileName}`), 220)
          };
        }
      });

      return sendSuccess(res, {
        task: output.task,
        slug: output.result.slug,
        installPath: output.result.installPath,
        backupPath: output.result.backupPath,
        reloadMessage: output.result.reloadMessage,
        text: output.result.text
      });
    })
  );

  router.post(
    '/install',
    asyncHandler(async (req, res) => {
      const slug = openclawService.sanitizeSkillSlug(req.body?.slug);
      if (!slug) throw new HttpError(400, 'INVALID_SKILL_SLUG', 'invalid slug');

      const output = await taskService.runTask({
        type: 'skills.install',
        target: slug,
        message: `Install skill ${slug}`,
        action: async () => {
          const result = await openclawService.installSkill(slug);
          return {
            slug,
            text: result.text,
            message: shrink(pickText(result.text, `Installed ${slug}`), 220)
          };
        }
      });

      return sendSuccess(
        res,
        {
          task: output.task,
          slug,
          text: output.result.text
        },
        {
          legacy: {
            task: output.task,
            text: output.result.text
          }
        }
      );
    })
  );

  router.post(
    '/update',
    asyncHandler(async (req, res) => {
      const input = pickText(req.body?.slug);
      const slug = openclawService.sanitizeSkillSlug(input);

      if (input && !slug) {
        throw new HttpError(400, 'INVALID_SKILL_SLUG', 'invalid slug');
      }

      if (slug) {
        const output = await taskService.runTask({
          type: 'skills.update',
          target: slug,
          message: `Update skill ${slug}`,
          action: async () => {
            const result = await openclawService.updateSkill(slug);
            return {
              slug,
              text: result.text,
              message: shrink(pickText(result.text, `Updated ${slug}`), 220)
            };
          }
        });

        return sendSuccess(
          res,
          {
            task: output.task,
            slug,
            text: output.result.text
          },
          {
            legacy: {
              task: output.task,
              text: output.result.text
            }
          }
        );
      }

      const output = await taskService.runTask({
        type: 'skills.update-all',
        target: 'all',
        message: 'Update all skills',
        action: async () => {
          const result = await openclawService.updateAllSkills();
          return {
            text: result.text,
            message: shrink(pickText(result.text, 'Updated all skills'), 220)
          };
        }
      });

      return sendSuccess(
        res,
        {
          task: output.task,
          text: output.result.text
        },
        {
          legacy: {
            task: output.task,
            text: output.result.text
          }
        }
      );
    })
  );

  router.post(
    '/batch-update',
    asyncHandler(async (req, res) => {
      const slugs = toArray(req.body?.slugs)
        .map((item) => openclawService.sanitizeSkillSlug(item))
        .filter(Boolean);

      if (!slugs.length) {
        throw new HttpError(400, 'INVALID_BATCH_SLUGS', 'slugs[] is required');
      }

      const results = [];
      for (const slug of slugs) {
        try {
          const output = await taskService.runTask({
            type: 'skills.update',
            target: slug,
            message: `Update skill ${slug}`,
            action: async () => {
              const result = await openclawService.updateSkill(slug);
              return {
                text: result.text,
                message: shrink(pickText(result.text, `Updated ${slug}`), 220)
              };
            }
          });

          results.push({
            slug,
            ok: true,
            task: output.task,
            message: output.task.message,
            error: '',
            text: output.result.text
          });
        } catch (err) {
          results.push({
            slug,
            ok: false,
            task: err?.details?.task || null,
            message: pickText(err?.details?.task?.message, 'Update failed'),
            error: pickText(err?.message, 'Update failed'),
            text: ''
          });
        }
      }

      return sendSuccess(res, {
        total: slugs.length,
        success: results.filter((row) => row.ok).length,
        failed: results.filter((row) => !row.ok).length,
        results
      });
    })
  );

  router.delete(
    '/:slug',
    asyncHandler(async (req, res) => {
      const slug = openclawService.sanitizeSkillSlug(req.params.slug);
      if (!slug) throw new HttpError(400, 'INVALID_SKILL_SLUG', 'invalid slug');

      const output = await taskService.runTask({
        type: 'skills.remove',
        target: slug,
        message: `Remove skill ${slug}`,
        action: async () => {
          const result = await openclawService.removeSkill(slug);
          return {
            slug,
            text: result.text,
            message: shrink(pickText(result.text, `Removed ${slug}`), 220)
          };
        }
      });

      return sendSuccess(
        res,
        {
          task: output.task,
          slug,
          text: output.result.text
        },
        {
          legacy: {
            task: output.task,
            text: output.result.text
          }
        }
      );
    })
  );

  return router;
}

module.exports = {
  createSkillsRouter
};
