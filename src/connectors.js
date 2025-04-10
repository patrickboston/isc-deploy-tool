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
}

/*TODO: When deploying a SaaS source, follow these rules:
 * New source is deployed with attribute "connector" like so: connector: "7a74eb93-bff6-4c70-80c1-9d800ac793cd" 
 * the value is the ID of the tag that the source is going to reference via the GET /platform-connectors/:connectorId/tags endpoint
 * All the other attributes related to the connector then reference the same value (i.e. connectorId, connectorImplementationId, etc.)
 * 
 * The challenge here is that the connector value will be different per value, unless it also works with the name which i need to test
 * 
 * spConnectorInstanceId is the only attribute that is not the tag id but it generated when the source is created, so we just need to
 * make sure this is one that we retain during deployment if the source already exists
*/

export { buildAndDeployConnectors };
