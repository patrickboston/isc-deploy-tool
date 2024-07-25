import clc from "cli-color";
import * as fs from "fs";
import _ from 'lodash';
import { Paginator, PasswordPoliciesApi } from "sailpoint-api-client";
import winston from "winston";
import { handleHttpException, walk, writeConfigFile } from "../util.js";

const PASSWORD_POLICY = "PASSWORD_POLICY";
const existingAttributeToKeep = [
    "id"
];
let passwordPolicyCache;

const getAllPasswordPolicies = async (apiConfig) => {
    if (passwordPolicyCache) return passwordPolicyCache;
    
    const passwordPoliciesApi = new PasswordPoliciesApi(apiConfig);
    const passwordPoliciesResponse = await Paginator.paginate(passwordPoliciesApi, passwordPoliciesApi.listPasswordPolicies, { limit: 1000 }, 250);
    if (passwordPoliciesResponse.data) {
        passwordPolicyCache = passwordPoliciesResponse.data;
        return passwordPoliciesResponse.data;
    }
    return null;
}

const exportPasswordPolicies = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Password Policy Export"));
    const passwordPoliciesApi = new PasswordPoliciesApi(apiConfig);
    const passwordPoliciesResponse = await Paginator.paginate(passwordPoliciesApi, passwordPoliciesApi.listPasswordPolicies, { limit: 1000 }, 250);
    for (const passwordPolicy of passwordPoliciesResponse.data) {
        winston.info(`Exporting Password Policy: ${passwordPolicy.name} (${passwordPolicy.id})`);
        writeConfigFile(PASSWORD_POLICY, passwordPolicy.name, passwordPolicy);
    }
}

const migratePasswordPolicy = async (apiConfig, passwordPolicyJson) => {
    const passwordPoliciesApi = new PasswordPoliciesApi(apiConfig);
    let localPasswordPolicy = JSON.parse(passwordPolicyJson);

    //Check and see if a password policy with this name already exists in the target environment
    //We cannot filter on name so we need to compare each
    let currentTargetPasswordPolicy;
    const currentPasswordPoliciesResponse = await Paginator.paginate(passwordPoliciesApi, passwordPoliciesApi.listPasswordPolicies, { limit: 1000 }, 250);
    for (const currentPasswordPolicy of currentPasswordPoliciesResponse.data) {
        if (currentPasswordPolicy.name === localPasswordPolicy.name) {
            currentTargetPasswordPolicy = currentPasswordPolicy;
        }
    }

    if (!currentTargetPasswordPolicy) {
        winston.info(`Creating new password policy: ${localPasswordPolicy.name}`);
        try {
            const createPasswordPolicyResponse = await passwordPoliciesApi.createPasswordPolicy({
                passwordPolicyV3Dto: localPasswordPolicy
            });
            currentTargetPasswordPolicy = createPasswordPolicyResponse.data;
        } catch (error) {
            await handleHttpException(error);
        }
    } else {
        winston.info(`Updating existing password policy: ${currentTargetPasswordPolicy.name} (${currentTargetPasswordPolicy.id})`)

        //Restore attributes from the currently deployed target password policy into our template password policy
        for (const key of existingAttributeToKeep) {
            _.set(localPasswordPolicy, key, _.get(currentTargetPasswordPolicy, key));
        }

        //Update the password policy with all config, references, etc.
        try {
            const res = await passwordPoliciesApi.setPasswordPolicy({
                id: currentTargetPasswordPolicy.id,
                passwordPolicyV3Dto: localPasswordPolicy
            });
        } catch (error) {
            await handleHttpException(error);
        }
    }
}

const migratePasswordPolicies = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Password Policy Deployment"));
    const passwordPolicyFilePaths = walk("./build/config/PASSWORD_POLICY");

    //Iterate each password policy and pass it to migratePasswordPolicy
    for (const passwordPolicyFilePath of passwordPolicyFilePaths) {
        const passwordPolicy = fs.readFileSync(passwordPolicyFilePath);
        await migratePasswordPolicy(apiConfig, passwordPolicy);
    }
    winston.info(clc.bgGreen("Completed Password Policy Deployment"));
}

export {
    exportPasswordPolicies, getAllPasswordPolicies, migratePasswordPolicies
};

