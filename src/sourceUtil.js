import clc from "cli-color";
import { SourcesApi, Paginator } from "sailpoint-api-client";
import { writeConfigFile } from "./util.js";

/**
* Gets all sources via v3/sources and write appropriate 
* Source files and referenced objects
* @param {Configuration} apiConfig
*/
const getSources = async (apiConfig) => {
    console.info(clc.bgBlueBright("Performing Source export"));

    return new Promise((resolve, reject) => {
        const sourcesApi = new SourcesApi(apiConfig);
        Paginator.paginate(sourcesApi, sourcesApi.listSources, { limit: 1000 }, 250).then((response) => {
            //Iterate each source and extract referenced objects
            response.data.forEach((source) => {
                let sourceClone = structuredClone(source);
                const sourceName = source.name;
                console.log(clc.bgCyan(`Processing export for source: ${sourceName}`));

                //Grab CONNECTOR_SCHEMAs
                source.schemas.forEach((schemaReference) => {
                    sourcesApi.getSourceSchema({ sourceId: source.id, schemaId: schemaReference.id }).then((schemaResponse) => {
                        const schema = schemaResponse.data;
                        writeConfigFile("CONNECTOR_SCHEMA", schemaReference.name, schema, "SOURCE/" + sourceName + "/CONNECTOR_SCHEMA");
                    });
                });

                //Grab PROVISIONING_POLICYs
                sourcesApi.listProvisioningPolicies({ sourceId: source.id }).then((policiesResponse) => {
                    const policies = policiesResponse.data;
                    policies.forEach((policy) => {
                        const policyFileName = policy.name + "_" + policy.usageType;
                        writeConfigFile("PROVISIONING_POLICY", policyFileName, policy, "SOURCE/" + sourceName + "/PROVISIONING_POLICY");
                    });
                });

                //TODO: Password Policies are /cc endpoints, so SDKs endpoints for those
                //TODO: Correlation Configs are UI only /diana endpoints

                writeConfigFile("SOURCE", sourceName, source, "SOURCE/" + sourceName);
            });
        });
    });
};

export {
    getSources
};