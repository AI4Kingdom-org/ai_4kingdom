import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const VECTOR_STORE_ID = 'vs_AMJIJ1zfGnzHpI1msv4T8Ww3';

export async function DELETE(
  request: Request,
  { params }: { params: { fileName: string } }
) {
  try {
    // 获取 Vector Store 中的文件列表
    const vectorStoreFiles = await openai.beta.vectorStores.files.list(VECTOR_STORE_ID);
    
    // 找到匹配的文件
    const targetFile = await Promise.all(
      vectorStoreFiles.data.map(async (file) => {
        const fileInfo = await openai.files.retrieve(file.id);
        return fileInfo.filename === params.fileName ? file : null;
      })
    ).then(files => files.find(f => f !== null));

    if (!targetFile) {
      return NextResponse.json(
        { error: '文件不存在' },
        { status: 404 }
      );
    }

    // 直接删除底层文件对象
    await openai.files.del(targetFile.id);
    
    return NextResponse.json({ 
      message: '文件删除成功',
      fileId: targetFile.id
    });
  } catch (error) {
    console.error('文件删除失败:', error);
    return NextResponse.json(
      { error: '文件删除失败', details: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    );
  }
} 