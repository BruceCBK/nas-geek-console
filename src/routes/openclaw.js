const express = require('express');
const { sendSuccess } = require('../utils/response');
const { asyncHandler } = require('../utils/async-handler');
const { pickText, shrink, toArray } = require('../utils/text');

function createOpenClawRouter({ openclawService, taskService, logService }) {
  const router = express.Router();

  router.get(
    '/status',
    asyncHandler(async (_req, res) => {
      const payload = await openclawService.getStatus();
      return sendSuccess(res, payload, { legacy: payload });
    })
  );

  router.get(
    '/config',
    asyncHandler(async (_req, res) => {
      const payload = await openclawService.loadConfigJson();
      return sendSuccess(res, payload, {
        legacy: {
          config: payload.config,
          modelPrimary: payload.modelPrimary
        }
      });
    })
  );

  router.put(
    '/config',
    asyncHandler(async (req, res) => {
      const incoming = req.body?.config ?? req.body;
      const payload = await openclawService.saveConfigJson(incoming);
      await logService.append({
        action: 'openclaw.config.save',
        type: 'openclaw',
        target: 'openclaw.json',
        status: 'success',
        message: `Config saved, backup: ${payload.backupPath}`
      });
      return sendSuccess(res, payload, { legacy: payload });
    })
  );

  router.get(
    '/config/items',
    asyncHandler(async (_req, res) => {
      const payload = await openclawService.loadConfigJson();
      return sendSuccess(
        res,
        {
          modelPrimary: payload.modelPrimary,
          editableItems: payload.editableItems
        },
        {
          legacy: {
            modelPrimary: payload.modelPrimary,
            editableItems: payload.editableItems
          }
        }
      );
    })
  );

  router.put(
    '/config/items',
    asyncHandler(async (req, res) => {
      const payload = await openclawService.saveEditableConfigItems(toArray(req.body?.items));
      await logService.append({
        action: 'openclaw.config.items.save',
        type: 'openclaw',
        target: 'openclaw.json',
        status: 'success',
        message: `Editable config saved, backup: ${payload.backupPath}`
      });

      return sendSuccess(
        res,
        {
          backupPath: payload.backupPath,
          modelPrimary: payload.modelPrimary,
          editableItems: payload.editableItems
        },
        {
          legacy: {
            backupPath: payload.backupPath,
            modelPrimary: payload.modelPrimary,
            editableItems: payload.editableItems
          }
        }
      );
    })
  );

  router.post(
    '/config/rollback-latest',
    asyncHandler(async (_req, res) => {
      const payload = await openclawService.rollbackConfigLatest();
      await logService.append({
        action: 'openclaw.config.rollback-latest',
        type: 'openclaw',
        target: payload.appliedBackupPath,
        status: 'success',
        message: `Config rolled back to backup: ${payload.appliedBackupPath}`
      });

      return sendSuccess(
        res,
        {
          appliedBackupPath: payload.appliedBackupPath,
          rollbackBackupPath: payload.rollbackBackupPath,
          modelPrimary: payload.modelPrimary,
          editableItems: payload.editableItems
        },
        {
          legacy: {
            appliedBackupPath: payload.appliedBackupPath,
            rollbackBackupPath: payload.rollbackBackupPath,
            modelPrimary: payload.modelPrimary,
            editableItems: payload.editableItems
          }
        }
      );
    })
  );

  router.get(
    '/model-options',
    asyncHandler(async (_req, res) => {
      const payload = await openclawService.loadConfigJson();
      const options = openclawService.listModelSwitchOptions();
      return sendSuccess(
        res,
        {
          currentModelPrimary: pickText(payload?.modelPrimary),
          currentThinkingDefault: pickText(payload?.config?.agents?.defaults?.thinkingDefault),
          options
        },
        {
          legacy: {
            currentModelPrimary: pickText(payload?.modelPrimary),
            currentThinkingDefault: pickText(payload?.config?.agents?.defaults?.thinkingDefault),
            options
          }
        }
      );
    })
  );

  router.post(
    '/model/switch',
    asyncHandler(async (req, res) => {
      const modelPrimary = pickText(req.body?.modelPrimary);
      const dryRun = String(req.body?.dryRun || '').toLowerCase() === 'true' || req.body?.dryRun === true;

      if (dryRun) {
        const payload = await openclawService.switchModelPrimaryProfile(modelPrimary, {
          dryRun: true,
          reload: false
        });
        return sendSuccess(res, payload, { legacy: payload });
      }

      const output = await taskService.runTask({
        type: 'openclaw.model.switch',
        target: modelPrimary,
        message: `Switch model to ${modelPrimary}`,
        action: async () => {
          const result = await openclawService.switchModelPrimaryProfile(modelPrimary, {
            dryRun: false,
            reload: true
          });
          return {
            payload: result,
            message: shrink(
              pickText(
                result?.reloadText,
                `model switched to ${result?.next?.modelPrimary || modelPrimary}`
              ),
              220
            )
          };
        }
      });

      const payload = output.result?.payload || {};
      await logService.append({
        action: 'openclaw.model.switch',
        type: 'openclaw',
        target: pickText(payload?.next?.modelPrimary, modelPrimary),
        status: 'success',
        message: `模型切换完成：${pickText(payload?.next?.modelPrimary, modelPrimary)}（thinking=${pickText(payload?.next?.thinkingDefault, '-')})`,
        meta: {
          backupPath: payload?.backupPath,
          touchedPaths: payload?.touchedPaths,
          previous: payload?.previous,
          next: payload?.next
        }
      });

      return sendSuccess(
        res,
        {
          task: output.task,
          ...payload
        },
        {
          legacy: {
            task: output.task,
            ...payload
          }
        }
      );
    })
  );

  router.post(
    '/model-primary',
    asyncHandler(async (req, res) => {
      const payload = await openclawService.saveModelPrimary(req.body?.modelPrimary);
      await logService.append({
        action: 'openclaw.model-primary',
        type: 'openclaw',
        target: payload.modelPrimary,
        status: 'success',
        message: `Model primary set: ${payload.modelPrimary}`
      });
      return sendSuccess(res, payload, { legacy: payload });
    })
  );

  router.post(
    '/restart',
    asyncHandler(async (_req, res) => {
      const output = await taskService.runTask({
        type: 'gateway.restart',
        target: 'openclaw-gateway',
        message: 'Restart OpenClaw gateway',
        action: async () => {
          const result = await openclawService.restartGateway();
          return {
            text: result.text,
            message: shrink(pickText(result.text, 'Gateway restarted'), 220)
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

  router.get(
    '/service/status',
    asyncHandler(async (_req, res) => {
      const payload = await openclawService.getServiceStatus();
      return sendSuccess(res, payload, {
        legacy: {
          service: payload.service,
          detail: payload.detail,
          text: payload.text
        }
      });
    })
  );


  router.post(
    '/service/start',
    asyncHandler(async (_req, res) => {
      const output = await taskService.runTask({
        type: 'openclaw.service.start',
        target: 'openclaw.service',
        message: 'Start systemctl openclaw service',
        action: async () => {
          const result = await openclawService.startService();
          return {
            text: result.text,
            status: result.status,
            message: shrink(
              pickText(
                result?.status?.detail?.activeState,
                result.text,
                'systemctl openclaw start completed'
              ),
              220
            )
          };
        }
      });

      return sendSuccess(
        res,
        {
          task: output.task,
          text: output.result.text,
          status: output.result.status || null
        },
        {
          legacy: {
            task: output.task,
            text: output.result.text,
            status: output.result.status || null
          }
        }
      );
    })
  );

  router.post(
    '/service/restart',
    asyncHandler(async (_req, res) => {
      const output = await taskService.runTask({
        type: 'openclaw.service.restart',
        target: 'openclaw.service',
        message: 'Restart systemctl openclaw service',
        action: async () => {
          const result = await openclawService.restartService();
          return {
            text: result.text,
            status: result.status,
            message: shrink(
              pickText(
                result?.status?.detail?.activeState,
                result.text,
                'systemctl openclaw restart completed'
              ),
              220
            )
          };
        }
      });

      return sendSuccess(
        res,
        {
          task: output.task,
          text: output.result.text,
          status: output.result.status || null
        },
        {
          legacy: {
            task: output.task,
            text: output.result.text,
            status: output.result.status || null
          }
        }
      );
    })
  );

  router.post(
    '/service/stop',
    asyncHandler(async (_req, res) => {
      const output = await taskService.runTask({
        type: 'openclaw.service.stop',
        target: 'openclaw.service',
        message: 'Stop systemctl openclaw service',
        action: async () => {
          const result = await openclawService.stopService();
          return {
            text: result.text,
            status: result.status,
            message: shrink(
              pickText(
                result?.status?.detail?.activeState,
                result.text,
                'systemctl openclaw stop completed'
              ),
              220
            )
          };
        }
      });

      return sendSuccess(
        res,
        {
          task: output.task,
          text: output.result.text,
          status: output.result.status || null
        },
        {
          legacy: {
            task: output.task,
            text: output.result.text,
            status: output.result.status || null
          }
        }
      );
    })
  );

  return router;
}

module.exports = {
  createOpenClawRouter
};
