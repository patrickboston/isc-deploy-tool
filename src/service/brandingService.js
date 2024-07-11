import clc from "cli-color";
import * as fs from "fs";
import { BrandingApi } from "sailpoint-api-client";
import winston from "winston";
import { handleHttpException, writeConfigFile } from "../util.js";

const BRANDING_CONFIG = "BRANDING_CONFIG";

const exportBranding = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Branding Export"));
    const brandingApi = new BrandingApi(apiConfig);
    const brandingConfigResponse = await brandingApi.getBrandingList();
    writeConfigFile(BRANDING_CONFIG, BRANDING_CONFIG, brandingConfigResponse.data);
}

const updateBranding = async (apiConfig, targetEnvName) => {
    winston.info(clc.bgBlueBright("Starting Branding Deployment"));
    const brandingConfigsSource = fs.readFileSync("./build/config/BRANDING_CONFIG/BRANDING_CONFIG.json");
    let localBrandingConfigs = JSON.parse(brandingConfigsSource);
    const brandingApi = new BrandingApi(apiConfig);

    //Fetch logo file
    const logoFileName = `./assets/${targetEnvName}.png`;
    let logoFile;
    if (fs.existsSync(logoFileName)) {
        logoFile = new Blob([fs.readFileSync(logoFileName)]);
    } else {
        winston.info(clc.yellow(`PNG image does not exist in ./assets directory for environment [${targetEnvName}]. Branding image will not be uploaded. Full file name should be ./assets/${targetEnvName}.png`));
    }
    
    //Differs from other objects as we need to iterate each branding config in the array of configs
    for (const localBrandingConfig of localBrandingConfigs) {
        //Check and see if a branding config with this name already exists in the target environment
        let currentTargetBrandingConfig;
        try {
            const currentTargetBrandingCoonfigResponse = await brandingApi.getBranding({
                name: localBrandingConfig.name
            });
            currentTargetBrandingConfig = currentTargetBrandingCoonfigResponse.data;
        } catch (error) {
            if (error.response.status === 404) {
                winston.debug(`Branding Config [${localBrandingConfig.name}] does not exist yet`);
            } else {
                handleHttpException(error);
            }
        }

        if (!currentTargetBrandingConfig) {
            winston.info(clc.bgBlueBright(`Creating new branding config for: ${localBrandingConfig.name}`));
            try {
                const createBrandingConfigResponse = await brandingApi.createBrandingItem({
                    name: localBrandingConfig.name,
                    productName: localBrandingConfig.productName,
                    actionButtonColor: localBrandingConfig.actionButtonColor != null ? localBrandingConfig.actionButtonColor : undefined,
                    activeLinkColor: localBrandingConfig.activeLinkColor != null ? localBrandingConfig.activeLinkColor : undefined,
                    emailFromAddress: localBrandingConfig.emailFromAddress != null ? localBrandingConfig.emailFromAddress : undefined,
                    fileStandard: logoFile != null ? logoFile : undefined,
                    loginInformationalMessage: localBrandingConfig.loginInformationalMessage != null ? localBrandingConfig.loginInformationalMessage : undefined,
                    navigationColor: localBrandingConfig.navigationColor != null ? localBrandingConfig.navigationColor : undefined
                });
                currentTargetBrandingConfig = createBrandingConfigResponse.data;
            } catch (error) {
                await handleHttpException(error);
            }
        } else {
            winston.info(`Updating existing branding config: ${localBrandingConfig.name}`);
            try {
                const res = await brandingApi.setBrandingItem({
                    name: localBrandingConfig.name,
                    name2: localBrandingConfig.name,
                    productName: localBrandingConfig.productName,
                    actionButtonColor: localBrandingConfig.actionButtonColor != null ? localBrandingConfig.actionButtonColor : undefined,
                    activeLinkColor: localBrandingConfig.activeLinkColor != null ? localBrandingConfig.activeLinkColor : undefined,
                    emailFromAddress: localBrandingConfig.emailFromAddress != null ? localBrandingConfig.emailFromAddress : undefined,
                    fileStandard: logoFile != null ? logoFile : undefined,
                    loginInformationalMessage: localBrandingConfig.loginInformationalMessage != null ? localBrandingConfig.loginInformationalMessage : undefined,
                    navigationColor: localBrandingConfig.navigationColor != null ? localBrandingConfig.navigationColor : undefined
                });
            } catch (error) {
                await handleHttpException(error);
            }            
        }
    }
}

export {
    exportBranding,
    updateBranding
};

