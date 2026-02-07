"""
Azure Blob Storage Service - For storing call recordings
"""
import logging
from datetime import datetime, timedelta
from typing import Optional, BinaryIO
from uuid import UUID

from app.core.config import settings

logger = logging.getLogger(__name__)


class AzureStorageService:
    """
    Service for uploading and managing call recordings in Azure Blob Storage.
    
    Usage:
        storage = AzureStorageService()
        url = await storage.upload_recording(recording_data, "call_123.wav")
        secure_url = storage.get_secure_url("call_123.wav", expiry_hours=24)
    """
    
    def __init__(self):
        self._blob_service_client = None
        self._container_client = None
    
    @property
    def is_configured(self) -> bool:
        """Check if Azure Storage is properly configured"""
        return settings.is_azure_storage_configured
    
    def _get_blob_service_client(self):
        """Get or create Azure Blob Service client"""
        if self._blob_service_client is None:
            try:
                from azure.storage.blob import BlobServiceClient
                self._blob_service_client = BlobServiceClient.from_connection_string(
                    settings.azure_storage_connection_string
                )
            except ImportError:
                logger.error("azure-storage-blob package not installed. Run: pip install azure-storage-blob")
                raise
        return self._blob_service_client
    
    def _get_container_client(self):
        """Get or create container client"""
        if self._container_client is None:
            service = self._get_blob_service_client()
            self._container_client = service.get_container_client(settings.azure_storage_container)
            
            # Create container if it doesn't exist
            try:
                self._container_client.get_container_properties()
            except Exception:
                logger.info(f"Creating container: {settings.azure_storage_container}")
                self._container_client.create_container()
        
        return self._container_client
    
    async def upload_recording(
        self,
        recording_data: bytes,
        filename: str,
        content_type: str = "audio/wav",
        metadata: Optional[dict] = None
    ) -> str:
        """
        Upload a call recording to Azure Blob Storage.
        
        Args:
            recording_data: The audio file content as bytes
            filename: Name for the blob (e.g., "call_abc123.wav")
            content_type: MIME type of the file
            metadata: Optional metadata to attach to the blob
            
        Returns:
            The blob URL (not a SAS URL - use get_secure_url for that)
        """
        if not self.is_configured:
            logger.warning("Azure Storage not configured - cannot upload recording")
            return ""
        
        try:
            from azure.storage.blob import ContentSettings
            
            container = self._get_container_client()
            blob_client = container.get_blob_client(filename)
            
            # Upload the recording
            blob_client.upload_blob(
                recording_data,
                overwrite=True,
                content_settings=ContentSettings(content_type=content_type),
                metadata=metadata or {}
            )
            
            logger.info(f"Uploaded recording to Azure: {filename}")
            return blob_client.url
            
        except Exception as e:
            logger.error(f"Failed to upload recording to Azure: {e}")
            raise
    
    async def upload_recording_from_url(
        self,
        source_url: str,
        filename: str,
        auth: Optional[tuple] = None,
        metadata: Optional[dict] = None
    ) -> str:
        """
        Download a recording from a URL and upload to Azure.
        Used for fetching Twilio recordings.
        
        Args:
            source_url: URL to download the recording from
            filename: Name for the blob
            auth: Optional (username, password) tuple for basic auth
            metadata: Optional metadata
            
        Returns:
            The Azure blob URL
        """
        if not self.is_configured:
            logger.warning("Azure Storage not configured - cannot upload recording")
            return ""
        
        try:
            import httpx
            
            # Download the recording from Twilio
            async with httpx.AsyncClient() as client:
                if auth:
                    response = await client.get(source_url, auth=auth, follow_redirects=True)
                else:
                    response = await client.get(source_url, follow_redirects=True)
                response.raise_for_status()
                recording_data = response.content
            
            # Determine content type
            content_type = response.headers.get("content-type", "audio/wav")
            
            # Upload to Azure
            return await self.upload_recording(
                recording_data,
                filename,
                content_type=content_type,
                metadata=metadata
            )
            
        except Exception as e:
            logger.error(f"Failed to download and upload recording: {e}")
            raise
    
    def get_secure_url(
        self,
        blob_name: str,
        expiry_hours: int = 24
    ) -> str:
        """
        Generate a SAS URL for secure, time-limited access to a recording.
        
        Args:
            blob_name: Name of the blob
            expiry_hours: How many hours the URL should be valid
            
        Returns:
            SAS URL for the blob
        """
        if not self.is_configured:
            logger.warning("Azure Storage not configured")
            return ""
        
        try:
            from azure.storage.blob import generate_blob_sas, BlobSasPermissions
            from datetime import timezone
            
            # Parse account info from connection string
            connection_parts = dict(
                part.split("=", 1) 
                for part in settings.azure_storage_connection_string.split(";") 
                if "=" in part
            )
            account_name = connection_parts.get("AccountName", "")
            account_key = connection_parts.get("AccountKey", "")
            
            if not account_name or not account_key:
                logger.error("Could not parse Azure Storage account info from connection string")
                return ""
            
            # Generate SAS token
            sas_token = generate_blob_sas(
                account_name=account_name,
                container_name=settings.azure_storage_container,
                blob_name=blob_name,
                account_key=account_key,
                permission=BlobSasPermissions(read=True),
                expiry=datetime.now(timezone.utc) + timedelta(hours=expiry_hours)
            )
            
            # Build full URL
            blob_url = f"https://{account_name}.blob.core.windows.net/{settings.azure_storage_container}/{blob_name}?{sas_token}"
            
            return blob_url
            
        except Exception as e:
            logger.error(f"Failed to generate SAS URL: {e}")
            return ""
    
    async def delete_recording(self, blob_name: str) -> bool:
        """
        Delete a recording from Azure Blob Storage.
        
        Args:
            blob_name: Name of the blob to delete
            
        Returns:
            True if deleted successfully
        """
        if not self.is_configured:
            logger.warning("Azure Storage not configured")
            return False
        
        try:
            container = self._get_container_client()
            blob_client = container.get_blob_client(blob_name)
            blob_client.delete_blob()
            logger.info(f"Deleted recording from Azure: {blob_name}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to delete recording: {e}")
            return False
    
    async def list_recordings(
        self,
        prefix: Optional[str] = None,
        max_results: int = 100
    ) -> list:
        """
        List recordings in the container.
        
        Args:
            prefix: Optional prefix to filter blobs
            max_results: Maximum number of results
            
        Returns:
            List of blob names
        """
        if not self.is_configured:
            return []
        
        try:
            container = self._get_container_client()
            blobs = container.list_blobs(name_starts_with=prefix)
            
            results = []
            for blob in blobs:
                if len(results) >= max_results:
                    break
                results.append({
                    "name": blob.name,
                    "size": blob.size,
                    "created": blob.creation_time,
                    "content_type": blob.content_settings.content_type if blob.content_settings else None
                })
            
            return results
            
        except Exception as e:
            logger.error(f"Failed to list recordings: {e}")
            return []


# Singleton instance
azure_storage_service = AzureStorageService()
