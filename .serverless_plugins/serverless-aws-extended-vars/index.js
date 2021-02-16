'use strict';

class ServerlessAwsExtendedVars {
  constructor(serverless, options) {
    this.variablePrefix = 'awsext';
    this.serverless = serverless;
    this.options = options || {};
    this.debug = this.options.debug || process.env.SLS_DEBUG;
    this.cache = {};
    this.pluginName = 'ServerlessAwsExtendedVars';

    const getVariable = this.getVpcVariableValue.bind(this);
    this.variableResolvers = { [this.variablePrefix]: getVariable };
  }

  verboseLog(logMessage) {
    if (!this.debug) {
      return;
    }
    this.serverless.cli.log(`${this.pluginName}: ${logMessage}`);
  }

  async getDefaultVpcId() {
    const vpcRes = await this.serverless.getProvider('aws').request('EC2', 'describeVpcs', {
      Filters: [
        {
          Name: 'isDefault',
          Values: ['true'],
        },
      ],
    });
    const defaultVpcs = vpcRes.Vpcs || [];
    if (defaultVpcs.length === 0) {
      return undefined;
    }
    this.verboseLog(`Default vpc: ${defaultVpcs[0].VpcId}`);
    return defaultVpcs[0].VpcId;
  }

  async getDefaultSubnetIds() {
    const vpcId = await this.getDefaultVpcId();
    if (!vpcId) {
      return [];
    }
    const baseParams = {
      Filters: [
        {
          Name: 'vpc-id',
          Values: [vpcId],
        },
      ],
    };
    const subnets = [];
    let isProcessing = true;
    let nextToken = undefined;
    while (isProcessing) {
      const subnetRes = await this.serverless
        .getProvider('aws')
        .request('EC2', 'describeSubnets', { ...baseParams, NextToken: nextToken });
      const subnetIds = (subnetRes.Subnets || []).map((subnet) => subnet.SubnetId);
      subnets.push(...subnetIds);
      nextToken = subnetRes.NextToken;
      isProcessing = !!nextToken;
    }
    this.verboseLog(`Default subnets: ${subnets.join(', ')}`);
    return subnets;
  }

  async getDefaultSecurityGroupId() {
    const vpcId = await this.getDefaultVpcId();
    const secRes = await this.serverless.getProvider('aws').request('EC2', 'describeSecurityGroups', {
      Filters: [
        {
          Name: 'vpc-id',
          Values: [vpcId],
        },
        {
          Name: 'group-name',
          Values: ['default'],
        },
      ],
    });
    const defaultGroups = secRes.SecurityGroups || [];
    if (defaultGroups.length === 0) {
      return undefined;
    }
    this.verboseLog(`Default security group: ${defaultGroups[0].GroupId}`);
    return defaultGroups[0].GroupId;
  }

  async performRequest(reqType, reqFunction) {
    if (this.cache[reqType]) {
      return this.cache[reqType];
    }
    const result = await reqFunction();
    this.cache[reqType] = result;
    return result;
  }

  async getVpcVariableValue(fullValueType) {
    const valueType = fullValueType.trim().replace(`${this.variablePrefix}:`, '');
    if (valueType === 'defaultVpcId') {
      return this.performRequest(valueType, this.getDefaultVpcId.bind(this));
    }
    if (valueType === 'defaultSubnetIds') {
      return this.performRequest(valueType, this.getDefaultSubnetIds.bind(this));
    }
    if (valueType === 'defaultSecurityGroupId') {
      return this.performRequest(valueType, this.getDefaultSecurityGroupId.bind(this));
    }
    return undefined;
  }
}

module.exports = ServerlessAwsExtendedVars;
