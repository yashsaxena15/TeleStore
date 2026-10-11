# src/Database/Mongodb/db.py

from pymongo import MongoClient , server_api

from d4rk.Logs import setup_logger

logger = setup_logger("Database")

class Database:
    client = None
    db = None
    is_connected = False
    def __init__(self):
        pass

    def connect(self,name: str, collections: list = [],DATABASE_URL: str =None):
        self.database_name = name.replace(" ","")
        self._collections = collections
        self._DATABASE_URL = DATABASE_URL
        if not DATABASE_URL:
            logger.warning("DATABASE_URL is not set in the environment variables.")
            exit()
        try:
            self.client = MongoClient(DATABASE_URL,server_api=server_api.ServerApi('1'))
            self.db = self.client[self.database_name]
            self._load_custom_collections()
            self.is_connected = True
        except Exception as e:
            logger.warning(f"Failed to connect to MongoDB: {e}")
            exit()
        if self.is_connected:
            try:
                self.client.admin.command('ping')
                logger.info(f"successfully connected to {name} Mongodb!")
            except Exception as e:
                logger.warning(f"Something Went Wrong While Connecting To Database! : {e}")
                self.is_connected = False
                exit()

    def _load_custom_collections(self):
        for CustomClass in self._collections:
            collection_name = str(CustomClass.__name__).title()
            base_collection = self.get_collection(collection_name)
            instance = CustomClass(base_collection)
            setattr(self, collection_name, instance)
            
    def get_collection(self, collection):
        return self.db[collection]
    
db = Database()
    