'use strict';

const { spawnSync } = require('child_process');
const validateConfiguration = require('./validateConfiguration');

class ServerlessDockerAutobuild {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.region = this.serverless.provider.region;
    this.config = (this.serverless.custom || {}).docker || {};
    this.debug = this.options.debug || process.env.SLS_DEBUG;
    this.pluginName = 'ServerlessDockerAutobuild';
    this.dockerCommand = this.config.docker.cli || process.env.SLS_DOCKER_CLI || 'docker';
    this.cache = {};

    this.hooks = {
      'before:package:createDeploymentArtifacts': this.build.bind(this),
      'before:deploy:function:packageFunction': this.build.bind(this),
      'before:offline:start': this.build.bind(this),
      'before:offline:start:init': this.build.bind(this),
      'before:invoke:local:invoke': this.build.bind(this),
    };
  }

  async getAwsAccountId() {
    if (this.cache.awsAccountId) {
      return this.cache.awsAccountId;
    }
    const res = await this.serverless.getProvider('aws').request('STS', 'getCallerIdentity', {});
    this.cache.awsAccountId = (res || {}).Account;
    this.verboseLog(`AWS account ID: ${this.cache.awsAccountId}`);
    return this.cache.awsAccountId;
  }

  verboseLog(logMessage) {
    if (!this.debug) {
      return;
    }
    this.serverless.cli.log(`${this.pluginName}: ${logMessage}`);
  }

  spawn(command, args, options) {
    return spawnSync(command, args, {
      stdio: 'ignore',
      ...options,
    });
  }

  async getEcrRegistry() {
    const accountId = await this.getAwsAccountId();
    return `${accountId}.dkr.ecr.${this.region}.amazonaws.com`;
  }

  async authenticate() {
    const registry = await this.getEcrRegistry();
    const { status } = this.spawn('aws', [
      'ecr get-login-password --region',
      this.region,
      '|',
      this.dockerCommand,
      'login --username AWS --password-stdin',
      registry,
    ]);
    if (status !== 0) {
      throw new Error('Docker authentication error');
    }
    this.verboseLog('Authenticated the Docker CLI to the Amazon ECR registry');
  }

  isDockerDaemonRunning() {
    const { status } = this.spawn(this.dockerCommand, ['version']);
    return status === 0;
  }

  getImage() {
    return `${this.getImageName()}:${this.getImageTag()}`;
  }

  getImageName() {
    return this.config.name.trim();
  }

  getImageTag() {
    return this.config.tag.trim() || 'latest';
  }

  getImageBuildArgs() {
    const configArgs = (this.config.buildArgs || '').split(/\s+/);
    const customArgs = (process.env.SLS_DOCKER_ARGS || '').split(/\s+/);
    return [...configArgs, ...customArgs].filter((arg) => !!arg);
  }

  buildImage() {
    const buildArgs = this.getImageBuildArgs();
    const { status } = this.spawn(this.dockerCommand, ['build', ...buildArgs, '-t', this.getImage(), '.']);
    if (status !== 0) {
      throw new Error('Build of the docker image failed');
    }
  }

  async pushImage() {
    const registry = await this.getEcrRegistry();
    const ecrImage = `${registry}/${this.getImage()}`;
    const { status: tagStatus } = this.spawn(this.dockerCommand, ['tag', this.getImage(), ecrImage]);
    if (tagStatus !== 0) {
      throw new Error('Unable to tag the image');
    }
    const { status: pushStatus } = this.spawn(this.dockerCommand, ['push', ecrImage]);
    if (pushStatus !== 0) {
      throw new Error('Unable to push the image to the AWS registry');
    }
  }

  async build() {
    validateConfiguration(this.config);
    if (!this.isDockerDaemonRunning()) {
      throw new Error('Docker daemon is not running');
    }
    await this.authenticate();
    await this.buildImage();
    await this.pushImage();
  }
}

module.exports = ServerlessDockerAutobuild;
