import clc from "cli-color";
import * as fs from "fs";
import { PasswordConfigurationApi } from "sailpoint-api-client";
import winston from "winston";
import { handleHttpException, walk, writeConfigFile } from "../util.js";
import path from "path";

const ORG_CONFIG = "ORG_CONFIG";
const PASSWORD_ORG_CONFIG = "PASSWORD_ORG_CONFIG";

const exportOrgConfigs = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Org Config Export"));

    winston.info("Exporting Password Org Config");
    const passwordConfigApi = new PasswordConfigurationApi(apiConfig);
    const passwordConfigResponse = await passwordConfigApi.getPasswordOrgConfig();
    writeConfigFile(ORG_CONFIG, PASSWORD_ORG_CONFIG, passwordConfigResponse.data);
}

const migrateOrgConfigs = async (apiConfig, targetEnvName) => {
    winston.info(clc.bgBlueBright("Starting Org Config Deployment"));
    const orgConfigFilePaths = walk("./build/config/ORG_CONFIG");

    //Iterate each org config and use appropriate API to migrate it
    for (const orgConfigFilePath of orgConfigFilePaths) {
        const orgConfigSource = fs.readFileSync(orgConfigFilePath);
        const localOrgConfigSource = JSON.parse(orgConfigSource);

        if (path.basename(orgConfigFilePath, path.extname(orgConfigFilePath)) === PASSWORD_ORG_CONFIG) {
            winston.info("Deploying Password Org Config");
            const passwordConfigApi = new PasswordConfigurationApi(apiConfig);
            winston.info("Updated Password Org Config");
            try {
                await passwordConfigApi.putPasswordOrgConfig({
                    passwordOrgConfig: localOrgConfigSource
                });
            } catch (error) {
                handleHttpException(error);
            }
        }
    }
    winston.info(clc.bgGreen("Completed Org Config Deployment"));
}

export {
    exportOrgConfigs,
    migrateOrgConfigs
};

