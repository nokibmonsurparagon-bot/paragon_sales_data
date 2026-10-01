import { Router } from 'express';
import {
  idParamSchema,
  masterDataCreateSchemas,
  masterDataListQuerySchema,
  masterDataUpdateSchemas,
  type MasterDataEntity,
} from '@paragon/shared';
import { authenticate, requirePermission } from '../../core/middleware.js';
import { created, ok, parseBody, parseParams, parseQuery } from '../../core/http.js';
import { masterDataService } from './master-data.service.js';

/** GET is open to every signed-in user (form dropdowns); changes need MASTER_DATA_MANAGE. */
export function masterDataRouter(entity: MasterDataEntity): Router {
  const service = masterDataService(entity);
  const router = Router();
  router.use(authenticate);

  router.get('/', async (req, res) => ok(res, await service.list(parseQuery(masterDataListQuerySchema, req))));
  router.get('/:id', async (req, res) => ok(res, await service.get(parseParams(idParamSchema, req).id)));
  router.post('/', requirePermission('MASTER_DATA_MANAGE'), async (req, res) =>
    created(res, await service.create(parseBody(masterDataCreateSchemas[entity], req)), 'Created'),
  );
  router.patch('/:id', requirePermission('MASTER_DATA_MANAGE'), async (req, res) =>
    ok(res, await service.update(parseParams(idParamSchema, req).id, parseBody(masterDataUpdateSchemas[entity], req)), 'Updated'),
  );
  return router;
}
