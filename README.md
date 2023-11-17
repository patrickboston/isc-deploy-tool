# IdentityNow Object Migration Tool
The IdentityNow Object Migration tool is a NodeJS command-line utility that allows you to export configuration objects such as Sources, Transforms, Rules, and more out of one IdentityNow environment and import/deploy them to other IdentityNow environments. It utulizes the [SP-Config API endpoints](https://developer.sailpoint.com/idn/api/beta/sp-config) to perform all export and import operations. One of the main benefits from using this tool is the ability to maintain single configuration objects that can be deploy to any environemnt via tokenization. This allows Source Code Management to actually make sense for IDN implementations and this process could easily be plugged into a CI/CD pipeline.

It offers the following features:
- Export objects as-is (raw) out of an environment
- Export objects and perform reverse-tokenization via JSONPath which replaces actual setting values with a token in the format of `%%TOKEN_NAME%%`. This allows a single object to be maintained in a code repository which can be "built" for any IdentityNow environment
- Tokenize and deploy objects to a target IdentityNow environment which is the process of replacing the repository tokens with actual setting values which are needed for a specific environment (i.e. IQService host for an Active Directory Source)

If used properly, this tool can offer deployment workflows like the following:
1. Perform initial sandbox setup
2. Export objects you wish to be maintained in SCM and to be deployed to higher environments via this process
3. Replace configuration values with tokens in configuration files and set up reverse tokenization to retain tokens on subsequent tenant exports
4. Continue development in sandbox and export periodially, committing changes to a SCM repository. Changes could also be made directly in JSON configuration files in local repository and deployed back to an environment
5. Once configuration is fully exported, tokenized, and ready to deploy to another environment, use the deploy process

## Setup
This a NodeJS project that was written on NodeJS 18. You will need NodeJS installed prior to using this tool. Find the latest NodeJS download here: https://nodejs.org/en/download

You can then clone this repository. Once the repository is cloned, run `npm install` within the cloned repository directory to install all project dependencies.

You will also need to set up the following files in the root of your project to be able to export/import from IdentityNow environments:
- `<env>.env.js` - Holds the parameters needed to login to hit IDN API endpoints via a PAT (Personal Access Token). There is an example in this repository, but it needs to look like this:
```js
export default
    {
        baseurl: "https://<env>.api.identitynow-demo.com",
        clientId: "id1234",
        clientSecret: "secret1234",
        tokenUrl: "https://<env>.api.identitynow-demo.com/oauth/token",
    }
```
- `export-config.js` - Contains the JSON object that is needed for the SP-Config tenant export process to run. This is where you can pick and choose what exactly you want to be exported out of an environment. For more information, see the following: https://developer.sailpoint.com/idn/api/beta/export-sp-config/
```js
export default
    {
        "description": "Export Job",
        "excludeTypes": [
            
        ],
        "includeTypes": [
            "SOURCE"
        ],
        "objectOptions": {
            "SOURCE": {
                "includedIds": [
                ],
                "includedNames": [
                    "Active Directory"
                ]
            }
        }
    }
```
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
- `<env>.target.js` - Contains entries where the key is the token in your config files (which is put there manually or by reverse-tokenization) and the value is the specific value for that token that you want to be deployed to a target IdentityNow environment when running the `deploy` command
```js
export default
    {
        "%%AD_OWNER_ID%%": "ABCD1234",
        "%%AD_IQSERVICE_PORT%%": "888888",
    }
```

## Commands
Once you have all the pre-reqs above setup, you can now start running some commands. Open up your favorite terminal and navigate to your project location. Our `src/index.js` file is the main file that is run with NodejS. We run the app with the following if we wanted
```
node src/index.js --export --detokenize
```
However, in the `package.json`, there are a number of scripts set up which make the commanda slightly easier to run

**NOTE: The example commands below all use `:win` variation of the commands. If you are on a Linux OS, omit the `:win` when running the command. There are different sets of commands because of how dynamic command line parameters are passed in NodeJS**

### Export
To export objects from a specific environment and perform reverse-tokenization based on properties defined in your `reverse.target.js` file, run the following where `<env>` is the actual name of your environemnt such as `sb`. This process relies on the `export-config.js` file you have configured to determine which objects you want to export out of your source IdentityNow environment.

**NOTE:** The export process will overwrite any manual changes made in your `/config/` directory. This is why it is crucial to set up your reverse tokenization properties if you wish to retain a neutral object state that can be deployed to any target environment.
```
npm run export:win -src-env=<env>
```

### Deploy/Import
To perform tokenization and deploy/import into a specific environemnt based on tokens defined in your `<env>.target.js` file, run the following where `<env>` is the actual name of your environemnt such as `sb`
```
npm run deploy:win -target-env=<env>
```

## Known Issues/Limitations
- SP-Config APIs allow exports of objects which are not able to be imported. See more here: https://developer.sailpoint.com/idn/docs/saas-configuration
- SP-Config APIs do not export encrypted attributes such as passwords. This means they will not exist on your exported objects any subsequent imports of those object will clear out those encrypted attributes
- SP-Config imports can fail if referenced objects do not exist yet. For example, if an Identity Profile attribute references a Source that does not exist, you may receive a dependency failure. You may need to import some objects before others to resolve this until this tool imports objects in a specific order. Example error
```json
"IDENTITY_PROFILE": {
    "infos": [],
    "warnings": [],
    "errors": [
        {
            "key": "IDENTITY_PROFILE_IMPORT_FAILED",
            "text": "An error occurred while importing Identity Profile with name 'Employee'",
            "detail": {
                "exceptionMessage": "Referenced Authoritative Source \"{1}\" was not found."
            }
        }
    ],
    "importedObjects": []
}
```
- SP-Config Import relies on certain ID references to be retained. This means ID references will need to be tokenized in some objects. The known ones are:
  - All objects 
    - `owner.id`
    ```json
    "owner": {
        "type": "IDENTITY",
        "id": "87b682d779e2419cb1875b759b7fc2af",
        "name": "pboston.pboston"
    },
    ```
    - RULE Reference `id`
    ```JSON
    "reference": {
        "type": "RULE",
        "id": "daf71540b5274f4eb32fa572796ac683",
        "name": "Cloud Promote Identity Attribute"
    }
    ```
  - Source
    - passwordPolicies[*].id (only on update imports for an object, initial creation does not need it)
    ```json
    "passwordPolicies": [
        {
            "type": "PASSWORD_POLICY",
            "id": "4b10c69768a040019383afb258898e67",
            "name": "Default"
        }
    ]
    ```

## Appendix
### Finding Owner Info via API
One of the easiest ways is to use the `/v3/search` endpoints to search for the specific identity you want. For example:
```json
{
    "indices": [
        "identities"
    ],
    "queryType": "SAILPOINT",
    "queryVersion": "5.2",
    "query": {
        "query": "lastName:Ingon"
    }
}
```
Will give you a result like so which you just need the `id` and `name` from:
```json
[
    {
        "name": "46-7960700",
        "firstName": "Brook",
        "lastName": "Ingon",
        "displayName": "Brook Ingon",
        "id": "0c5f67b1ec1a46cda26a3996e3155f34",
        "email": "test@test.com",
        "created": "2023-09-25T02:25:46.652Z",
        "inactive": false,
        "protected": false,
        "status": "UNREGISTERED",
        "employeeNumber": "46-7960700",
        "manager": {
            "id": "0b7f4a4a70ee4ef8985b0d756e0d104d",
            "name": "07-7960018",
            "displayName": "Rhett Opie"
        },
        "isManager": false,
        "identityProfile": {
            "id": "f8e3f69568b64fd0974bbf658fa3b540",
            "name": "HR"
        },
        "source": {
            "id": "43b2199fe2b349049c04573b138587fb",
            "name": "HR"
        },
        "attributes": {
            .....
        }
    }
]
```

You can also retrieve this information from the Search UI by performing your identity search and adding the `ID` column to your search result table:
![Idetity Search](/resources/readme/IdentitySearchID.png)

Lastly, you can also get this information when viewing an identity from the identity list page:
![Identity View](/resources/readme/IdentityView.png)