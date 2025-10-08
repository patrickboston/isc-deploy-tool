# Identity Security Cloud Object Deployment Tool
The Identity Security Cloud Object Deployment Tool (**ISC ODT**) is a NodeJS command-line utility that allows you to export configuration objects such as Sources, Transforms, Rules, and more out of one Identity Security Cloud environment and import/deploy them to other Identity Security Cloud environments. It utilizes various v3/beta API endpoints to perform all export and import operations. One of the main benefits of using this tool is the ability to maintain single configuration objects that can be deployed to any environment via tokenization. This allows Source Code Management to actually make sense for ISC implementations and this process could easily be plugged into a CI/CD pipeline.

It offers the following features:
- **EXPORT:** Export objects and perform reverse-tokenization via JSONPath which replaces actual configuration values with a token in the format of `%%TOKEN_NAME%%`. This allows a single object to be maintained in a code repository which can be "built" for any target Identity Security Cloud environment
- **BUILD/TOKENIZE:** Tokenize and build objects for a target Identity Security Cloud environment to validate tokenization before deployment which is the process of replacing the repository tokens with actual target configuration values which are needed for a specific target environment (i.e. IQService host for an Active Directory Source)
- **DEPLOY:** Deploy built/tokenized objects to a target Identity Security Cloud environment with dynamic object reference lookup and insertion (i.e. owners, source schemas, etc.)



## Supported Object Types
The following object types are currently supported for export/deploy:
- ORG_CONFIG (includes multiple org configurations such as session, lockout, network, service provider, global password, and public identities)
- CLOUD_RULE (already approved and deployed by SailPoint)
- CONNECTOR_RULE
- TRANSFORM
- SOURCE
  - Includes correlation config, schemas, provisioning policies, aggregation schedules, machine classification/mapping configs and referenced connector libraries (i.e. JDBC JAR files). **Does not include password policy references**
  - Custom SaaS connectors can also be compiled for custom SaaS sources
- SERVICE_DESK_INTEGRATION
- IDENTITY_OBJECT_CONFIG
- IDENTITY_PROFILE (includes lifecycle states tied to the identity profile. **Does not include security settings**)
- ACCESS_REQUEST_CONFIG
- NOTIFICATION_TEMPLATE
- FORM_DEFINITION
- WORKFLOW
- GOVERNANCE_GROUP
- BRANDING_CONFIG
- PASSWORD_POLICY
- PASSWORD_INSTRUCTION (custom UI instructions for self-service password reset, etc.)


## Setup/Configuration Files
This a NodeJS project that was written on NodeJS 18. You will need NodeJS installed prior to using this tool. Find the latest NodeJS download here: https://nodejs.org/en/download

You can then clone this repository. Once the repository is cloned, run `npm install` within the cloned repository directory to install all project dependencies.

You will also need to set up the following files in the root of your project to be able to export/import from Identity Security Cloud environments:
- `<env>.env.js` - Holds the parameters needed to login to hit ISC API endpoints via a PAT (Personal Access Token). **This file is in the default `.gitignore` and should never be pushed to the remote repository**. There is an example in this repository, but it needs to look like this:
```js
export default
    {
        baseurl: "https://<env>.api.identitynow.com",
        clientId: "id1234",
        clientSecret: "secret1234",
        tokenUrl: "https://<env>.api.identitynow.com/oauth/token",
    }
```

> [!NOTE]
> Environment variables can be used instead of using this configuration file. This allows a build server or CI/CD pipeline to inject these variables into the process. The required environment variables are `BASE_URL`, `TOKEN_URL`, `CLIENT_ID`, and `CLIENT_SECRET`. The values of these environment variables should reflect the same as documented above

- `reverse.target.js` - Contains entries specific for each config file that you would want to perform reverse-tokenization on when running the `export` command. Each entry under config file contains a key for the JSONPath of where to replace the value with the token specified. Reverse-tokenization simply means replacing the value of an entry in an object that is exported with a common token which can be replaced with an actual value when deploying that object to another environment
```js
export default
    {
        "SOURCE/Active Directory.json": {
            "$.object.owner.id": "%%AD_OWNER_ID%%",
            "$.object.connectorAttributes.IQServicePort": "%%AD_IQSERVICE_PORT%%",
        }
    }
```
- `<env>.target.js` - Contains entries where the key is the token in your config files (which is put there manually or by reverse-tokenization) and the value is the specific configuration value for that token that you want to be deployed to a target Identity Security Cloud environment when running the `deploy` command
```js
export default
    {
        "%%AD_OWNER_ID%%": "ABCD1234",
        "%%AD_IQSERVICE_PORT%%": "888888",
    }
```
- `<env>.secrets.js` - (Optional) Contains entries where the key is the token in your config files (which is put there manually or by reverse-tokenization) and the value is the plaintext secret/password for that token that you want to be deployed to a target Identity Security Cloud environment when running the `deploy` command. **This file is in the default .gitignore and should never be committed to the remote repository. This should only be used if you do not want to manually encrypt a password in a target environment so you can have the encrypted version of a secret to put into the `<env>.secrets.js` file**
```js
export default
    {
        "%%AD_PASSWORD%%": "StrongPassword1234"
    }
```
- `<env>.ignore.js` - (Optional) Contains an array of specific objects to not deploy. This can be useful when deployment objects differ in ISC environments such as production integrating with prod and non-prod sources and sandbox integrating with only non-prod sources. See examples below:
```js
export default
    [
        "SOURCE:ProductionWebApplication",
        "SOURCE:ProductionDatabaseApplication",
    ]
```
- `export-config.js` - Contains import configuration items that pertain to the export process, particularly it holds `omitProperties` which has all of the JSON properties that should be omitted from objects such as `id` references, created/modified timestamps, rule `id` references, etc. Additional entries can be added/removed as needed per implementation requirements, but the standard set provided is meant to make objects repository-oriented
- `export-ignore.js` - Contains an array of specific objects to ignore (not write to local config directory) when performing an export. Each entry must be in this specific format: `OBJECT_TYPE:Object Name`. If a file exists in your local `./config` directory and is then later added to this file, it will be deleted on the next export run See examples below:
```js
export default
    [
        "TRANSFORM:identityDisplayName",
        "SOURCE:TestAD",
        "IDENTITY_OBJECT_CONFIG:IDENTITY_OBJECT_CONFIG" //Doesn't have a name so we put the type twice
    ]
```

## Project Structure
Below outlines the project structure for an ISC ODT project:
```
📦isc-deploy-tool
 ┣ 📂assets - Contains images for branding
 ┣ 📂build - Contains built/tokenized config objects as a result of the build or deploy command
 ┣ 📂config - Contains all config objects you want to manage with this process. Populated by the export command
 ┣ 📂connectorLib - Contains connector dependencies (primarily JDBC jars, but could support other dependencies)
 ┃ ┗ 📜mysql-connector-j-8.3.0.jar - Example JAR file for a JDBC connector
 ┣ 📂connectors - Contains any custom SaaS connectors you wish to compile and deploy
 ┣ 📜.gitignore - Default gitignore
 ┣ 📜example.env.js - Example env.js file for connecting to a tenant. Should be copied and renamed i.e. sb.env.js
 ┣ 📜example.target.js - Example target.js file for connecting to a tenant. Should be copied and renamed i.e. sb.target.js
 ┣ 📜export-config.js - Global configuration file for export process
 ┣ 📜export-ignore.js - Global configuration file for ignoring certain objects during export
 ┣ 📜package-lock.json - nodejs package-lock. Do not touch unless you know what you are doing
 ┣ 📜package.json - nodejs package. Do not touch unless you know what you are doing
 ┣ 📜README.md - The readme you are reading
 ┗ 📜reverse.target.js - Reverse tokenization properties
```

## Config Directory Structure
When the export command is run, it will automatically create a directory in the root of the project called `/config`. This is where all of the configuration JSON files from the export will be reverse-tokenized and stored. It will look something like this:
```
config
 ┣ ACCESS_REQUEST_CONFIG
 ┃ ┗ ACCESS_REQUEST_CONFIG.json
 ┣ BRANDING_CONFIG
 ┃ ┗ BRANDING_CONFIG.json
 ┣ GOVERNANCE_GROUP
 ┣ IDENTITY_OBJECT_CONFIG
 ┃ ┗ IDENTITY_OBJECT_CONFIG.json
 ┣ IDENTITY_PROFILE
 ┃ ┣ HR
 ┃ ┃ ┣ LIFECYCLE_STATE
 ┃ ┃ ┃ ┣ Active.json
 ┃ ┃ ┃ ┗ Inactive.json
 ┃ ┃ ┗ HR.json
 ┣ NOTIFICATION_TEMPLATE
 ┣ RULE
 ┣ SOURCE
 ┃ ┣ Active Directory
 ┃ ┃ ┣ ATTR_SYNC_SOURCE_CONFIG
 ┃ ┃ ┃ ┗ Active Directory_ATTR_SYNC.json
 ┃ ┃ ┣ CONNECTOR_SCHEMA
 ┃ ┃ ┃ ┣ account.json
 ┃ ┃ ┃ ┣ group.json
 ┃ ┃ ┃ ┗ sharedMailbox.json
 ┃ ┃ ┣ CORRELATION_CONFIG
 ┃ ┃ ┃ ┗ Active Directory [source] Account Correlation.json
 ┃ ┃ ┣ PROVISIONING_POLICY
 ┃ ┃ ┃ ┣ Account_CREATE.json
 ┃ ┃ ┗ Active Directory.json
 ┣ TRANSFORM
 ┗ WORKFLOW
```
As you can see, some more complex object types such as sources will have subdirectories for directly referenced objects such as schemas. This structure helps to keep everything conveniently organized and it is very important to keep this format as is important for the deploy/import process. Files should not be moved unless you know what you are doing.

When the `build` or `deploy` command is run, an additional directory will be created in the root of the project called `/build`. It will contain all built/tokenized objects that are going to be deployed to the target environment. It will be cleaned up every time the `deploy` command is run. You can view the built objects to view what will be/was deployed to a target environment. These built objects will contain token values for the target environment, however, it will not contain references `ids`. Those are dynamically inserted during the deployment process.



## Commands
Once you have all the pre-requisites above setup, you will be able to run commands to perform operations. Open up your favorite terminal and navigate to your project location. Our `src/index.js` file is the main file that is run with NodejS. We can run the app with the following if we wanted
```
node src/index.js --export --detokenize
```
However, in the `package.json`, there are a number of scripts set up which make the commands slightly easier to run

> [!NOTE]
> Ensure you put the double dash (`--`) after the initial command and your arguments as documented below for each command

### Export
To export objects from a specific environment and perform reverse-tokenization based on properties defined in your `reverse.target.js` file, run the following where `<env>` is the actual name of your environment such as `sb`.

**NOTE:** The export process will overwrite any manual changes made in your `/config/` directory. This is why it is crucial to set up your reverse tokenization properties if you wish to retain a neutral object state that can be deployed to any target environment.
```
npm run export -- --src_env=<env>
```

All supported object types will be exported by default. To ignore exporting specific files, please see the information on the `export-ignore.js` file above.

### Build
To perform tokenization and build objects locally for specific target environment based on tokens defined in your `<env>.target.js` file, run the following where `<env>` is the actual name of your environment such as `sb`. The built objects will reside in the `/build/config` directory
```
npm run build -- --target_env=<env>
```

### Deploy/Import
To perform tokenization and deploy/import into a specific target environment based on tokens defined in your `<env>.target.js` file, run the following where `<env>` is the actual name of your environment such as `sb`
```
npm run deploy -- --target_env=<env>
```

> [!NOTE]
> The deploy/import execution process will halt on errors return from ISC APIs. Errors will be recorded in the terminal if encountered. You must resolve any issues with configuration objects that are throwing errors during deployment or report at lower level tool bugs with the team so they can resolve them. We do this as opposed to continuing on errors due to object dependencies.

### All Command Arguments
Below is a reference for all arguments for the commands above
```
- src_env=<env> - Source environment for export command
- target_env=<env> - Target environment for build/deploy commands
- log_level=<level> - Sets winston log level
- skip_connector_lib - Allows you to skip connector file upload if arg is present
```

## Custom SaaS Connectors
ODT supports compiling and deploying custom TypeScript SaaS connectors per [SailPoint's SaaS connector framework](https://developer.sailpoint.com/docs/connectivity/saas-connectivity). The presence of a TypeScript/NodeJS project inside of the `./connectors` directory within your ODT repository will automatically include it for compilation and deployment. Source deployments are also automated to lookup the connector deployed and referenced it when possible.


## Configuration Object Guidelines/Considerations
Follow these guidelines to ensure these object types are deployed successfully.

### Object References by `id`
In ISC, majority of object references are by `id` as opposed to a softer reference such as `name`. As part of the export process, `id` and other environment specific data are omitted from objects to make objects more common/repository oriented. When you run the deployment process to a target environment, `id` references that are needed are dynamically inserted into objects by looking up objects by `name` in the target deployment environment. **You do not need to lookup and insert `id` references yourself before deployments**. This is true only for places in an object where we can expect an object/id reference. You may have workflows which make an HTTP request back to ISC which rely on an a hard-coded `id` for a source - this tool is not designed to detect those occurrences and it would probably be inappropriate to make certain assumptions something an ISC `id` reference when can not clearly identify it. This means there are still some cases you need to tokenize these sorts of things. An example would be a workflow action which uses the generic HTTP action back to ISC to get an account for a specific source based on the source's `id`.
```json
"Get Banner Account": {
    "actionId": "sp:http",
    "attributes": {
        "authenticationType": "OAuth",
        "method": "get",
        "oAuthClientId": "5f33a932a4de45ec971009dfc370c9e4",
        "oAuthClientSecret": "$.secrets.caced813-4e69-46eb-92a4-145edd04057b",
        "oAuthCredentialLocation": "oAuthInHeader",
        "oAuthTokenUrl": "%%BASE_API_URL%%/oauth/token",
        "requestContentType": "json",
        "url": "%%BASE_API_URL%%/v3/accounts",
        "urlParams": {
            "filters": "identityId eq \"{{$.trigger.identity.id}}\" and sourceId eq \"%%BANNER_SOURCE_ID%%\""
        }
    },
    "displayName": "",
    "nextStep": "Check If Has Banner Account",
    "type": "action",
    "versionNumber": 2
},
```


### Owner References
There are many objects throughout ISC that have owner references which point to an identity that have created an object, modified an object, etc. It is very important that owners are properly set up in exported configuration objects.

By default, you will see owner references contain a `type` which is always set to `IDENTITY`, an `id` which points to a very environment specific `id` for the identity that owns the objects (this is actually omitted during the export process, but is the core reference needed), and lastly a `name` which is more of a soft reference that points to the owning identity. The `name` value can very between different object types, but is most often the `displayName` of an identity which is not ideal and does not guarantee a unique identity when looking up an identity by this name during migration to other environments. The only unique soft reference attribute on identities that guarantee a unique lookup is the `alias` attribute. **When you run the export process, objects with owner references will automatically have the `name` property value written as the owning identity's `alias` as opposed to their `displayName`.** This will allow us to perform unique identity lookups when migrating objects with owners to another environment. If an identity with that alias does not exist, the migration import will fail. If you need different owners per environment because of preference or because an identity with a specific alias will never exist in the next environment, you will need to perform the following tokenization steps:
1. Set up a reverse token in `reverse.target.js` for the object being exported. You could also hard code an identity alias here that will be the same owner across all environments instead of using a token
```json
{
    "SOURCE/Active Directory/Active Directory.json": {
        "$.owner.name": "%%AD_OWNER_ALIAS%%"
    }
}
```
2. For each `<env>.target.js` properties files, set up a corresponding token with a value that points to the `alias` attribute of the owning identity
```json
{
    "%%AD_OWNER_ALIAS%%": "03-1013143",
    "%%AD_IQSERVICE_PORT%%": "1111",
}
```

During the deployment process, the pipeline will attempt to find a corresponding identity by that alias via the `GET /beta/identities` endpoint to get the unique `id` and insert it into the `owner` reference before deploying.

The following object types have owner references that will need to be considered during your implementation:
- ACCESS_REQUEST_CONFIG
- IDENTITY_PROFILE
- SOURCE
- WORKFLOW

### Secrets
Objects such as sources and service desk integrations contain encrypted secrets/passwords for connecting to downstream applications. Plain text secrets are either entered through the UI or via API and when saved, they are automatically encrypted using SailPoint's backend encryption process. Additionally, you may be connecting to different environments of these downstream applications from different ISC environments (i.e. Non-Prod AD vs Prod AD). This means the encrypted secret value will differ per ISC environments. Passwords can be deployed via this build tool and there are two methods for doing that:
1. Tokenization of Encrypted Secrets - Encrypted secret values can simply be stored in your `<env>.target.js` file. The issue here is that you will need to have those encrypted secret values for all environments. For example, if you onboard a source into your sandbox ISC environment which connects to a non-prod downstream application where in your production ISC tenant it will be connecting to the production instance of that downstream application, before you can deploy that new source to production ISC for the first time, you need the encrypted secret value. One way to do this would to create a dummy source in your production ISC tenant and provide the password in a password/secret field, save the source, and then fetch the encrypted value via API/VSCode/etc. and then plug that value into the appropriate token for that secret in your repository
2. Plaintext Secrets via Separate Secret Tokens - Another less-secure option this tool provides is a separate tokens file named `<env>.secrets.js`. This has the same exact concept of your `<env>.target.js` file, but is only used to store secrets in plaintext. These files would never be committed to a remote repository and would only be held by a trusted member of the team who is running the deployment process. The plaintext passwords would be provided when creating/updating objects via API calls and would be automatically encrypted by ISC

### Branding
In order to deploy a branding logo image, you must create a directory in the root of the project called `./assets`. This directory will contain your logo images in `.png` format only. The name of each png image should match the name of your target environment (`--target_env`) that you provide in the `deploy` command, for example: `prod.png`. If the file name is not set up properly, a warning will appear in the output logs

### Lifecycle States
When lifecycle states are exported, access profile and source ID references will be replaced with the names of the referenced objects. This allows us to perform a lookup of the objects by name and dynamically populate the IDs from the target environment. **Make sure these objects exist in the target deployment environment and names are consistent across environments for this reason**.

### Workflows
- When workflows are being updated via the deployment process, if they are enabled, they will be temporarily disabled (1-2 seconds) to perform the update, and then the enabled status defined in the workflow in the repository will be the final state the workflow ends up in. It will not be automatically enabled after update just because it was already enabled before we updated it with the pipeline.
- If your workflow has any secrets stored in it such as OAuth client secrets, when the workflow is saved via the UI, those secrets are encrypted and referenced via a special syntax (i.e. `$.secrets.d3b98a91-1060-471f-a255-fa8766eb56b5`). If you tokenize the actual secret values in your token files to be deployed, when you run the workflow it will error our saying the secret is not stored in the correct format as the secret with no be converted over to the other special encrypted format mentioned above until the workflow is saved from the UI again. To circumvent this, tokenize the special encrypted secret syntax (i.e. `$.secrets.d3b98a91-1060-471f-a255-fa8766eb56b5`), or after deployments you must go save the workflow in the UI again (**This may not always work from experience**).
- Workflows which utilize the **External Trigger** trigger type have a reference to the workflow ID in the API URL to launch the workflow externally. This will automatically be exported with the workflow `name` and replaced with the workflow `id` on deployment. It also contains a `clientId` for a set of OAuth credentials that have been generated for that external trigger. The `clientId` will be different per environment and it not automatically omitted during the export process on purpose. You should be tokenizing this value per environment after a set of OAuth credentials have been generated for the trigger
```json
"trigger": {
    "type": "EXTERNAL",
    "attributes": {
        "clientId": "c7f33278-03f9-4a2a-b390-d02c1d9058f9",
        "url": "/beta/workflows/execute/external/796857e8-5352-4e7d-9c98-fd2c97dce1ae"
    }
}
```

### Transforms
- During the export process, only non-internal (`"internal": false`) transforms are exported since internal transforms (maintained by SailPoint) cannot be changed
- If you are changing the `type` of a transform where that transform is already deployed to a target environment, the import will fail indicating that you cannot change the type. You must delete the transform in the target environment before you can be deploy the transform with the same name, or else create a new transform with a different name and update all references

### Rules
- The deployment process for rules injects the source code for the rule from the corresponding `<rule-name>.source.bsh` file created during an export.
- The export process for rules will automatically exclude the `sourceCode.script` attribute for `CONNECTOR_RULES`
- Cloud Rules (`CLOUD_RULE`) only which have been approved and deployed by SailPoint professional services can be deployed to other environments per SailPoint's processes. Cloud Rules do not have anything omitted from them during the export process because if any modifications are made to the file, the verification process during SP-Config import will fail for the rules

### Source Connector Files/Dependencies
Certain source types such as JDBC or SAP Direct require some sort of dependencies in order for them to operate correctly. This may be a JDBC driver for a JDBC source or some specific SAP Java binaries for an SAP Direct connector that SailPoint requires you to fetch and upload yourself. The deployment process supports uploading these connector file dependencies via the `v3/sources/:sourceId/upload-connector-file` endpoint. This is very useful when migrating these sources to higher environments so you do not need to manually remember to upload these dependencies per environment. You can tell if a source has connector library references by looking for the `connectorAttributes.connector_files` attribute. This is a comma-separated value of all the dependencies uploaded for that particular source. These dependencies are transferred to your VAs when you upload them through the source configuration UI or using the `/v3` endpoint mentioned before. The `connectorAttributes.connector_files` attribute is simply a pointer to the file name(s) on the VA. If this attribute exists, during the deployment process, it will look for these file names in `./connectorLib/` directory at the root of your project in order to upload the file via the API endpoint. If the file is not found, the process will fail with an error indicating that it could not find the dependency file.

If you wish to skip the connector file upload process, pass the command like argument `--skip_connector_lib`. The full command would look like:
```
npm run deploy -- --target_env=<env> --skip_connector_lib
```

### Deleting Objects
There are two scenarios to consider when deleting objects:
- When objects are deleted directly inside of a tenant, they must also be removed in your build directory/repository because the export process does not consider cleaning up objects that may have been deleted in a tenant. If not cleaned up, they may be re-deployed inadvertently
- When objects are deleted from your build directory/repository, they will not automatically be cleaned up during the next build deployment. You must also delete objects directly in the tenant if you are removing them from your build repository




## Deploying to a Clean Environment
When you are deploying to a clean environment for the first time (i.e. first time from Sandbox to Production), there are a few pre-requisites/guidelines that need to be followed:
- A Virtual Appliance cluster needs to be configured in the target tenant. Virtual appliance cluster names will most likely be different, so be sure to analyze all cluster references in sources, etc. and tokenize them as needed
- All owner references should be analyzed and tokenized as needed. Owner references may fail if aggregations have not occurred yet in the target environment. You can a standard identity such as `slpt.services` as the default owner on objects to avoid this issue. Another option would be to manually migrate your authoritative source and perform an aggregation to get your baseline identities created which could be referenced as owners (assuming their `alias` would be the same in both environments)
- Source attribute sync configurations may failed to deploy initially if an identity profile with the corresponding identity attributes does not exist yet. There is no real workaround for this at the moment. Some identity profiles rely on sources to exist before being created, so we are prioritizing that over attribute sync. You must run another import after identity profiles are created to allow attribute sync configs to be updated properly
  - To get around this, you can set the `enabled` property for each attribute you are syncing to `false` for the first deployment. This will avoid any validation checks against the identity profile attributes. Once the identity profile attributes exist after the initial deployment, reset the `enabled` property back to `true` for each attribute desired and then run the deployment process again



## Logging
The export/deploy processes print out various logs by default to show progress, warnings, and errors. The default log priority is `info`. In order to print more verbose logs, pass the `--log_level` parameter. The following are valid log levels prioritized from highest to lowest:
```
error: 0
warn: 1
info: 2
http: 3
verbose: 4
debug: 5
silly: 6
```

Most of the more detailed logging (HTTP requests, etc. is available at the `debug` level).



## Known Issues/Limitations
- Password policies themselves will be exported/deployed, but their references to sources cannot be automated at this time. The beta API endpoint is not documented so it's not in the SDK. A future enhancement could fix this once SailPoint includes the endpoint in the SDK
- When objects are exported and saved to a file, the file name becomes the name of the object. Any special characters not allowed in file names will be replaced with a dash (`-`)
- Workflow secrets such as OAuth client secrets cannot be converted to the proper secret pointers as the endpoint requires a browser JWT token