# K-File-Upload

Javascript uploader for file, allow to upload in background and in chunks (so not limited by max post size of server). Backend is php.

## Server side usage

Create two functions kfu_upload_done and kfu_upload_failed that are called when the file has either been uploaded or the upload has failed. They will have an array as the only argument containing :

    'max' => // number of chunks to upload,
    'chunksize' => // size of single chunk,
    'current' => // current number of chunks uploaded,
    'filename' => // filename,
    'filesize' => // filesize,
    'filetype' => // filetype,
    'token' => // a token for the upload,
    'hash' => // sha256 of the file,
    'path' => // file path,
    'parts' => // array of each chunk id

You need also to define two constants : KFU_UPLOAD_PATH and KFU_MAX_ALLOWED_SIZE. 
    
    KFU_MAX_ALLOWED_SIZE => set the max size that can be uploaded
    KFU_UPLOAD_PATH => root path for the uploaded file

The uploaded file will be in KFU_UPLOAD_PATH/$token/temp.bin and the array, in json format, is in KFU_UPLOAD_PATH/$token/metadata.json.

### Token

The token is used to check if the upload is allowed or not. Before starting your upload, you will send a message, in whatever way suits your needs, for an upload, check if that upload is allowed, generate a token, create the directory KFU_UPLOAD_PATH/$token which should be writable, send back to the client that will pass the token to the uploaded. When the upload begins, the script will check if that directory exists and is writable, if so, the upload is allowed.