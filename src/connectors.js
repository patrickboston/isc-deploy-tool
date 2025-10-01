import axios from "axios";
import { execSync } from "child_process";
import clc from "cli-color";
import * as fs from "fs";
import path from "path";
import winston from "winston";
import { handleHttpException } from "./util.js"
import FormData from "form-data";

const buildAndDeployConnectors = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting SaaS Connector Build & Deployment"));
    const connectorsDir = "./connectors";

    //Read each directory in ./connectors, the directory name will be used as the alias of the SaaS connector
    if (fs.existsSync(connectorsDir)) {
        for (const connectorDirAlias of fs.readdirSync(connectorsDir)) {
            const connectorPath = path.join(connectorsDir, connectorDirAlias);
            //Make sure it's a node project
            if (fs.existsSync(path.join(connectorPath, "package.json"))) {
                winston.info(`Building connector for alias [${connectorDirAlias}]`);
                winston.info(`Installing dependencies for [${connectorDirAlias}]...`);
                execSync("npm install", { cwd: connectorPath, stdio: "inherit" });
                winston.info(`Packaging connector [${connectorDirAlias}]...`);
                execSync("npm run pack-zip", { cwd: connectorPath, stdio: "inherit" });

                const distPath = path.join(connectorsDir, connectorDirAlias, "dist");
                const zipFile = fs.readdirSync(distPath).find((file) => file.endsWith(".zip"));
                const zipPath = path.join(distPath, zipFile);
                const fullFilePath = path.resolve(zipPath);
                const fileStream = fs.createReadStream(fullFilePath);
                winston.info(`Uploading SaaS connector archive file: [${zipPath}]`);

                let data = new FormData();
                data.append('file', fileStream);

                //Check if there is platform connector yet for this based on alias
                try {
                    const lookupResponse = await axios.request({
                        method: 'get',
                        url: `${apiConfig.basePath}/beta/platform-connectors/${connectorDirAlias}`,
                        headers: {
                            'Authorization': `Bearer ${await apiConfig.accessToken}`,
                        },
                    });
                    winston.info(`Connector by alias [${connectorDirAlias}] already exists with id: ${lookupResponse.data.id}`);
                } catch (error) {
                    if (error.response.status === 404) {
                        winston.debug(`Connector by alias [${connectorDirAlias}] does not exist yet, creating it`);
                        try {
                            const createResponse = await axios.request({
                                method: 'post',
                                url: `${apiConfig.basePath}/beta/platform-connectors`,
                                headers: {
                                    'Authorization': `Bearer ${await apiConfig.accessToken}`,
                                },
                                data: {
                                    alias: connectorDirAlias
                                }
                            });
                            winston.info(`Connector by alias [${connectorDirAlias}] created successfully with id: ${createResponse.data.id}`);
                        } catch (error) {
                            handleHttpException(error);
                        }
                    } else {
                        handleHttpException(error);
                    }
                }

                //Upload the connector archive zip, always just creates/updates latest tag
                try {
                    const uploadResponse = await axios.request({
                        method: 'post',
                        maxBodyLength: Infinity,
                        url: `${apiConfig.basePath}/beta/platform-connectors/${connectorDirAlias}/versions`,
                        headers: {
                            'Authorization': `Bearer ${await apiConfig.accessToken}`,
                            ...data.getHeaders()
                        },
                        data: data
                    });
                    winston.info(`Connector archive for [${connectorDirAlias}] uploaded successfully with version number: ${uploadResponse.data.version}`);
                } catch (error) {
                    await handleHttpException(error);
                }
            }
        };
    } else {
        winston.warn(clc.yellow(`Directory [${connectorsDir}] does not exist`));
    }
}

export { buildAndDeployConnectors };
