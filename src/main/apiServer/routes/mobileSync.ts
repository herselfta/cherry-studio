import type { Request, Response } from 'express'
import express from 'express'

import { loggerService } from '../../services/LoggerService'
import { mobileOnlineSyncServerService } from '../../services/MobileOnlineSyncServerService'

const logger = loggerService.withContext('ApiServerMobileSyncRoutes')

const router = express.Router()

router.get('/pull', async (req: Request, res: Response) => {
  const requestedCursor = Number(req.query.cursor || 0)
  const cursor = Number.isFinite(requestedCursor) && requestedCursor >= 0 ? requestedCursor : 0

  try {
    const result = await mobileOnlineSyncServerService.pullChanges(cursor)
    return res.json(result)
  } catch (error) {
    logger.error('Failed to pull mobile online sync changes', error as Error)
    return res.status(503).json({
      error: {
        message: error instanceof Error ? error.message : 'Failed to pull mobile online sync changes',
        type: 'mobile_sync_pull_failed'
      }
    })
  }
})

router.post('/push', async (req: Request, res: Response) => {
  const changes = Array.isArray(req.body?.changes) ? req.body.changes : []

  try {
    const result = await mobileOnlineSyncServerService.pushChanges(changes)
    return res.json(result)
  } catch (error) {
    logger.error('Failed to push mobile online sync changes', error as Error)
    return res.status(503).json({
      error: {
        message: error instanceof Error ? error.message : 'Failed to push mobile online sync changes',
        type: 'mobile_sync_push_failed'
      }
    })
  }
})

router.get('/debug', async (_req: Request, res: Response) => {
  try {
    const result = await mobileOnlineSyncServerService.getDebugState()
    return res.json(result)
  } catch (error) {
    logger.error('Failed to load mobile online sync debug state', error as Error)
    return res.status(503).json({
      error: {
        message: error instanceof Error ? error.message : 'Failed to load mobile online sync debug state',
        type: 'mobile_sync_debug_failed'
      }
    })
  }
})

export { router as mobileSyncRoutes }
