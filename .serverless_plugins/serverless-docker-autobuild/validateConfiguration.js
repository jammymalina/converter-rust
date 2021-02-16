'use strict';

const Ajv = require('ajv').default;

const schema = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      pattern: '^(?!\\s*$).+',
    },
    tag: {
      type: 'string',
      pattern: '^(?!\\s*$).+',
    },
    cli: {
      type: 'string',
      minLength: 1,
    },
    buildArgs: {
      type: 'string',
    },
  },
  required: ['name'],
};

module.exports = (configuration) => {
  const ajv = new Ajv();
  const validate = ajv.compile(schema);
  const valid = validate(configuration);
  if (!valid) {
    throw new Error(`Invalid docker configuration: ${validate.errors[0].message}`);
  }
};
