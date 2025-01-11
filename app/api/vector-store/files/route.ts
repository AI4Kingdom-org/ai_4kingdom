import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const VECTOR_STORE_ID = 'vs_AMJIJ1zfGnzHpI1msv4T8Ww3';

interface FileDetail {
  fileName: string;
  fileId: string;
  uploadDate: number;
}

type VectorStoreFilesResponse = Awaited<ReturnType<typeof openai.beta.vectorStores.files.list>>;

export async function GET() {
  try {
    let allFiles: FileDetail[] = [];
    let lastId: string | undefined = undefined;
    
    // 循环获取所有文件
    while (true) {
      const vectorStoreFiles: VectorStoreFilesResponse = await openai.beta.vectorStores.files.list(
        VECTOR_STORE_ID,
        lastId ? { after: lastId, limit: 100 } : { limit: 100 }
      );
      
      if (!vectorStoreFiles.data.length) break;
      
      // 获取这一批文件的详细信息
      const fileDetails = await Promise.all(
        vectorStoreFiles.data.map(async (file) => {
          try {
            const fileInfo = await openai.files.retrieve(file.id);
            return {
              fileName: fileInfo.filename,
              fileId: file.id,
              uploadDate: fileInfo.created_at
            };
          } catch (err) {
            console.error(`获取文件信息失败: ${file.id}`, err);
            return null;
          }
        })
      );
      
      // 过滤掉获取失败的文件
      const validFiles = fileDetails.filter((file): file is FileDetail => file !== null);
      allFiles = [...allFiles, ...validFiles];
      
      // 如果没有更多数据，退出循环
      if (vectorStoreFiles.data.length < 100) break;
      
      // 更新lastId为最后一个文件的ID
      lastId = vectorStoreFiles.data[vectorStoreFiles.data.length - 1].id;
    }
    
    // 按上传日期降序排序
    allFiles.sort((a, b) => 
      new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime()
    );
    
    return NextResponse.json(allFiles);
  } catch (error) {
    console.error('获取文件列表失败:', error);
    return NextResponse.json(
      { error: '获取文件列表失败', details: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    );
  }
} 