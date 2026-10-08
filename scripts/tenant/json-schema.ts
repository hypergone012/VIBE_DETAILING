#!/usr/bin/env tsx
/** pnpm tenant:schema — writes tenants/business.schema.json (editor autocompletion for business.json). */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { TENANTS_DIR } from './load.ts';
import { BusinessSchema } from './schema.ts';

const schema = z.toJSONSchema(BusinessSchema, { io: 'input', unrepresentable: 'any' });
writeFileSync(join(TENANTS_DIR, 'business.schema.json'), `${JSON.stringify(schema, null, 2)}\n`);
console.log('✓ tenants/business.schema.json');
