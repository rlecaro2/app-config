import { resolve, join, dirname } from 'path';
import Ajv from 'ajv';
import { JsonObject, isObject } from './common';
import { ParsedValue } from './parsed-value';
import { defaultAliases, EnvironmentAliases } from './environment';
import { FlexibleFileSource, FileSource } from './config-source';
import { ParsingExtension } from './extensions';
import { ValidationError, SecretsInNonSecrets, WasNotObject } from './errors';

export interface Options {
  directory?: string;
  fileNameBase?: string;
  environmentOverride?: string;
  environmentAliases?: EnvironmentAliases;
  parsingExtensions?: ParsingExtension[];
}

export type Validate = (fullConfig: JsonObject, parsed?: ParsedValue) => void;

export interface Schema {
  value: JsonObject;
  validate: Validate;

  /** @hidden */
  schemaRefs: JsonObject;
}

export async function loadSchema({
  directory = '.',
  fileNameBase = '.app-config.schema',
  environmentOverride,
  environmentAliases = defaultAliases,
  parsingExtensions = [],
}: Options = {}): Promise<Schema> {
  const source = new FlexibleFileSource(
    join(directory, fileNameBase),
    environmentOverride,
    environmentAliases,
  );
  const parsed = await source.readToJSON(parsingExtensions);

  if (!isObject(parsed)) throw new WasNotObject('JSON Schema was not an object');

  const ajv = new Ajv({ allErrors: true });

  const schemaRefs = await extractExternalSchemas(parsed);
  Object.entries(schemaRefs).forEach(([id, schema]) => ajv.addSchema(schema as object, id));

  // array of property paths that should only be present in secrets file
  const schemaSecrets: string[][] = [];

  ajv.addKeyword('secret', {
    validate(schema: any, data: any, parentSchema?: object, dataPath?: string) {
      if (!dataPath) return false;

      const [_, ...key] = dataPath.split('.');
      schemaSecrets.push(key);

      return schema === true;
    },
  });

  // default to draft 07
  if (!parsed.$schema) {
    parsed.$schema = 'http://json-schema.org/draft-07/schema#';
  }

  const validate = ajv.compile(parsed);

  return {
    value: parsed,
    schemaRefs,
    validate(fullConfig, parsed) {
      const valid = validate(fullConfig);

      if (!valid) {
        const err = new ValidationError(
          `Config is invalid: ${ajv.errorsText(validate.errors, { dataVar: 'config' })}`,
        );

        err.stack = undefined;

        throw err;
      }

      if (parsed) {
        // check that any properties marked as secret were from secrets file
        const secretsInNonSecrets = schemaSecrets.filter((path) => {
          const found = parsed.property(path);
          if (found) return !found.meta.fromSecrets;

          return false;
        });

        if (secretsInNonSecrets.length > 0) {
          throw new SecretsInNonSecrets(
            `Found ${secretsInNonSecrets
              .map((s) => `'.${s.join('.')}'`)
              .join(', ')} in non secrets file`,
          );
        }
      }
    },
  };
}

async function extractExternalSchemas(
  schema: JsonObject,
  schemas: JsonObject = {},
  cwd: string = process.cwd(),
): Promise<JsonObject> {
  if (schema && typeof schema === 'object') {
    for (const [key, val] of Object.entries(schema)) {
      if (key === '$ref' && typeof val === 'string') {
        // parse out "filename.json" from "filename.json#/Defs/ServerConfig"
        const [, , filepath, ref] = /^(\.\/)?([^#]*)(#?.*)/.exec(val)!;

        if (filepath) {
          // we resolve filepaths so that ajv resolves them correctly
          const resolvePath = resolve(join(cwd, filepath));
          const resolvePathEncoded = encodeURI(resolvePath);
          const child = (await new FileSource(resolvePath).readToJSON()) as JsonObject;

          await extractExternalSchemas(child, schemas, dirname(join(cwd, filepath)));

          if (!Array.isArray(schema)) {
            // replace the $ref inline with the resolvePath
            schema.$ref = `${resolvePathEncoded}${ref}`;
          }

          schemas[resolvePathEncoded] = child;
        }
      } else if (isObject(val)) {
        await extractExternalSchemas(val, schemas, cwd);
      }
    }
  }

  return schemas;
}