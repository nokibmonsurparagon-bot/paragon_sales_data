import { Router } from 'express';
import {
  idParamSchema,
  masterDataCreateSchemas,
  masterDataListQuerySchema,
  masterDataUpdateSchemas,
  masterImportQuerySchema,
  masterTemplateQuerySchema,
  type MasterDataEntity,
} from '@paragon/shared';
import { authenticate, importFileUpload, requirePermission } from '../../core/middleware.js';
import { created, ok, parseBody, parseParams, parseQuery } from '../../core/http.js';
import { contentDisposition } from '../attachments/attachments.service.js';
import { IMPORT_FILE_TYPE, masterDataService } from './master-data.service.js';

/** GET is open to every signed-in user (form dropdowns); changes need MASTER_DATA_MANAGE. */
export function masterDataRouter(entity: MasterDataEntity): Router {
  const service = masterDataService(entity);
  const router = Router();
  router.use(authenticate);

  router.get('/', async (req, res) => ok(res, await service.list(parseQuery(masterDataListQuerySchema, req))));
  // Before '/:id' so the static paths are not taken for ids.
  router.get('/import-template', requirePermission('MASTER_DATA_MANAGE'), async (req, res) => {
    const { buffer, fileName } = await service.template(parseQuery(masterTemplateQuerySchema, req).withData === 'true');
    res.setHeader('Content-Type', IMPORT_FILE_TYPE);
    res.setHeader('Content-Disposition', contentDisposition(fileName));
    res.send(buffer);
  });
  router.post('/import', requirePermission('MASTER_DATA_MANAGE'), importFileUpload, async (req, res) => {
    const dryRun = parseQuery(masterImportQuerySchema, req).dryRun === 'true';
    const result = await service.importFile(req.file, dryRun);
    ok(res, result, result.applied ? `Imported: ${result.created} added, ${result.updated} updated` : 'File checked');
  });
  router.get('/:id', async (req, res) => ok(res, await service.get(parseParams(idParamSchema, req).id)));
  router.post('/', requirePermission('MASTER_DATA_MANAGE'), async (req, res) =>
    created(res, await service.create(parseBody(masterDataCreateSchemas[entity], req)), 'Created'),
  );
  router.patch('/:id', requirePermission('MASTER_DATA_MANAGE'), async (req, res) =>
    ok(res, await service.update(parseParams(idParamSchema, req).id, parseBody(masterDataUpdateSchemas[entity], req)), 'Updated'),
  );
  return router;
}
