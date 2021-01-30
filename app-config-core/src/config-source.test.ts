import {
  CombinedSource,
  EnvironmentSource,
  FallbackSource,
  FileSource,
  FlexibleFileSource,
  LiteralSource,
  FileType,
  stringify,
} from './config-source';
import { ParsingExtension } from './parsed-value';
import { withTempFiles } from './test-util';

const flattenExtension: ParsingExtension = (value, [_, key]) => {
  if (key === '$flatten') {
    return (parse) => parse(value, { shouldFlatten: true });
  }

  return false;
};

const uppercaseExtension: ParsingExtension = (value) => {
  if (typeof value === 'string') {
    return (parse) => parse(value.toUpperCase());
  }

  return false;
};

describe('Parsing', () => {
  it('interprets an empty object', async () => {
    const source = new LiteralSource({});
    const parsed = await source.read();

    expect(parsed.sources[0]).toBe(source);
    expect(parsed.raw).toEqual({});
    expect(parsed.toJSON()).toEqual({});
    expect(parsed.toString()).toEqual('{}');
  });

  it('uses parsing extensions', async () => {
    const parsed = await new LiteralSource({
      $flatten: 'bar',
    }).read([flattenExtension]);

    expect(parsed.toJSON()).toEqual('bar');
  });

  it('uses parsing extensions in nested objects', async () => {
    const parsed = await new LiteralSource({
      foo: {
        $flatten: 'bar',
      },
    }).read([flattenExtension]);

    expect(parsed.toJSON()).toEqual({ foo: 'bar' });
  });

  it('uses value transform extension', async () => {
    const parsed = await new LiteralSource({
      foo: 'bar',
    }).read([uppercaseExtension]);

    expect(parsed.toJSON()).toEqual({ foo: 'BAR' });
  });

  it('uses multiple extensions', async () => {
    const parsed = await new LiteralSource({
      foo: {
        $flatten: 'bar',
      },
    }).read([flattenExtension, uppercaseExtension]);

    expect(parsed.toJSON()).toEqual({ foo: 'BAR' });
  });

  it('uses readToJSON shorthand', async () => {
    const parsed = await new LiteralSource({
      foo: {
        $flatten: 'bar',
      },
    }).readToJSON([flattenExtension]);

    expect(parsed).toEqual({ foo: 'bar' });
  });

  it('loads using readContents correctly', async () => {
    const [text, fileType] = await new LiteralSource({ foo: 'bar' }).readContents();

    expect([text, fileType]).toMatchSnapshot();
  });
});

describe('FileSource', () => {
  it('fails when file doesnt exist', async () => {
    await expect(new FileSource('test-file.json').read()).rejects.toThrow();
  });

  it('reads an empty JSON file', async () => {
    await withTempFiles(
      {
        'test-file.json': `{}`,
      },
      async (inDir) => {
        const source = new FileSource(inDir('test-file.json'));
        const parsed = await source.read();

        expect(parsed.sources[0]).toBe(source);
        expect(parsed.raw).toEqual({});
        expect(parsed.toJSON()).toEqual({});
        expect(parsed.toString()).toEqual('{}');
      },
    );
  });

  it('reads a simple JSON file', async () => {
    await withTempFiles(
      {
        'test-file.json': `{ "foo": true }`,
      },
      async (inDir) => {
        const source = new FileSource(inDir('test-file.json'));
        const parsed = await source.read();

        expect(parsed.sources[0]).toBe(source);
        expect(parsed.raw).toEqual({ foo: true });
        expect(parsed.toJSON()).toEqual({ foo: true });
        expect(parsed.toString()).toEqual('{"foo":true}');
      },
    );
  });
});

describe('FlexibleFileSource', () => {
  it('loads simple yaml app-config file', async () => {
    await withTempFiles(
      {
        'app-config.yml': `
          foo: bar
        `,
      },
      async (inDir) => {
        const source = new FlexibleFileSource(inDir('app-config'));
        const parsed = await source.read();

        expect(parsed.toJSON()).toEqual({ foo: 'bar' });
      },
    );
  });

  it('loads simple json app-config file', async () => {
    await withTempFiles(
      {
        'app-config.json': `{"foo": "bar"}`,
      },
      async (inDir) => {
        const source = new FlexibleFileSource(inDir('app-config'));
        const parsed = await source.read();

        expect(parsed.toJSON()).toEqual({ foo: 'bar' });
      },
    );
  });

  it('loads simple json5 app-config file', async () => {
    await withTempFiles(
      {
        'app-config.json5': `{foo: "bar"}`,
      },
      async (inDir) => {
        const source = new FlexibleFileSource(inDir('app-config'));
        const parsed = await source.read();

        expect(parsed.toJSON()).toEqual({ foo: 'bar' });
      },
    );
  });

  it('loads simple toml app-config file', async () => {
    await withTempFiles(
      {
        'app-config.toml': `
          foo = "bar"
        `,
      },
      async (inDir) => {
        const source = new FlexibleFileSource(inDir('app-config'));
        const parsed = await source.read();

        expect(parsed.toJSON()).toEqual({ foo: 'bar' });
      },
    );
  });

  it('loads app-config file with environment name', async () => {
    await withTempFiles(
      {
        'app-config.production.yml': `
          foo: bar
        `,
      },
      async (inDir) => {
        process.env.APP_CONFIG_ENV = 'production';
        const source = new FlexibleFileSource(inDir('app-config'));
        const parsed = await source.read();

        expect(parsed.toJSON()).toEqual({ foo: 'bar' });
      },
    );
  });

  it('loads app-config file with environment alias', async () => {
    await withTempFiles(
      {
        'app-config.prod.yml': `
          foo: bar
        `,
      },
      async (inDir) => {
        process.env.APP_CONFIG_ENV = 'production';
        const source = new FlexibleFileSource(inDir('app-config'));
        const parsed = await source.read();

        expect(parsed.toJSON()).toEqual({ foo: 'bar' });
      },
    );
  });

  it('loads using readContents correctly', async () => {
    await withTempFiles(
      {
        'app-config.yml': `
          foo: bar
        `,
      },
      async (inDir) => {
        const source = new FlexibleFileSource(inDir('app-config'));
        const [text, fileType] = await source.readContents();

        expect([text, fileType]).toMatchSnapshot();
      },
    );
  });
});

describe('EnvironmentSource', () => {
  it('fails when environment variable is missing', async () => {
    await expect(new EnvironmentSource('CONF').read()).rejects.toThrow();
  });

  it('reads a JSON environment variable', async () => {
    process.env.CONF = `{ "foo": true }`;
    const source = new EnvironmentSource('CONF');
    const parsed = await source.read();

    expect(parsed.sources[0]).toBe(source);
    expect(parsed.toJSON()).toEqual({ foo: true });
  });

  it('reads a YAML environment variable', async () => {
    process.env.CONF = `foo: bar`;
    const source = new EnvironmentSource('CONF');
    const parsed = await source.read();

    expect(parsed.sources[0]).toBe(source);
    expect(parsed.toJSON()).toEqual({ foo: 'bar' });
  });

  it('reads a TOML environment variable', async () => {
    process.env.CONF = `foo = "bar"`;
    const source = new EnvironmentSource('CONF');
    const parsed = await source.read();

    expect(parsed.sources[0]).toBe(source);
    expect(parsed.toJSON()).toEqual({ foo: 'bar' });
  });

  it('reads a JSON5 environment variable', async () => {
    process.env.CONF = `{ foo: "bar" }`;
    const source = new EnvironmentSource('CONF');
    const parsed = await source.read();

    expect(parsed.sources[0]).toBe(source);
    expect(parsed.toJSON()).toEqual({ foo: 'bar' });
  });
});

describe('CombinedSource', () => {
  it('fails when no sources are provided', () => {
    expect(() => new CombinedSource([])).toThrow();
  });

  it('combines a few sources', async () => {
    const source = new CombinedSource([
      new LiteralSource({ foo: 1 }),
      new LiteralSource({ bar: 2 }),
      new LiteralSource({ baz: 3 }),
    ]);

    const parsed = await source.read();

    expect(parsed.sources[0]).toBe(source);
    expect(parsed.toJSON()).toEqual({ foo: 1, bar: 2, baz: 3 });
  });

  it('loads using readContents correctly', async () => {
    const [text, fileType] = await new CombinedSource([
      new LiteralSource({ foo: 1 }),
      new LiteralSource({ bar: 2 }),
      new LiteralSource({ baz: 3 }),
    ]).readContents();

    expect([text, fileType]).toMatchSnapshot();
  });

  it('loads using readValue correctly', async () => {
    const value = await new CombinedSource([
      new LiteralSource({ foo: 1 }),
      new LiteralSource({ bar: 2 }),
      new LiteralSource({ baz: 3 }),
    ]).readValue();

    expect(value).toEqual({ foo: 1, bar: 2, baz: 3 });
  });
});

describe('FallbackSource', () => {
  it('fails when no sources are provided', () => {
    expect(() => new FallbackSource([])).toThrow();
  });

  it('selects the first source', async () => {
    const source = new FallbackSource([
      new LiteralSource({ foo: 1 }),
      new LiteralSource({ bar: 2 }),
      new LiteralSource({ baz: 3 }),
    ]);

    const parsed = await source.read();

    expect(parsed.sources[0]).toBe(source.sources[0]);
    expect(parsed.toJSON()).toEqual({ foo: 1 });
  });

  it('selects source when first one fails', async () => {
    const source = new FallbackSource([
      new FileSource('test-file.json'),
      new LiteralSource({ bar: 2 }),
      new LiteralSource({ baz: 3 }),
    ]);

    const parsed = await source.read();

    expect(parsed.sources[0]).toBe(source.sources[1]);
    expect(parsed.toJSON()).toEqual({ bar: 2 });
  });

  it('loads using readContents correctly', async () => {
    const [text, fileType] = await new FallbackSource([
      new LiteralSource({ foo: 1 }),
      new LiteralSource({ bar: 2 }),
      new LiteralSource({ baz: 3 }),
    ]).readContents();

    expect([text, fileType]).toMatchSnapshot();
  });

  it('loads using readValue correctly', async () => {
    const value = await new FallbackSource([
      new LiteralSource({ foo: 1 }),
      new LiteralSource({ bar: 2 }),
      new LiteralSource({ baz: 3 }),
    ]).readValue();

    expect(value).toEqual({ foo: 1 });
  });
});

describe('stringify', () => {
  it('stringifies JSON', () => {
    expect(stringify({ foo: 'bar' }, FileType.JSON)).toMatchSnapshot();
  });

  it('stringifies JSON5', () => {
    expect(stringify({ foo: 'bar' }, FileType.JSON5)).toMatchSnapshot();
  });

  it('stringifies YAML', () => {
    expect(stringify({ foo: 'bar' }, FileType.YAML)).toMatchSnapshot();
  });

  it('stringifies TOML', () => {
    expect(stringify({ foo: 'bar' }, FileType.TOML)).toMatchSnapshot();
  });

  it('stringifies RAW', () => {
    // RAW only stringifies primitive values
    expect(stringify(11, FileType.RAW)).toMatchSnapshot();
    expect(stringify('foobar', FileType.RAW)).toMatchSnapshot();
    expect(stringify(true, FileType.RAW)).toMatchSnapshot();
  });
});