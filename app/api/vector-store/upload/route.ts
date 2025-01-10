import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json(
        { error: '没有找到文件' },
        { status: 400 }
      );
    }

    // 将文件转换为Buffer并上传到OpenAI
    const buffer = await file.arrayBuffer();
    const blob = new Blob([buffer]);
    
    // 上传文件到OpenAI并创建vector store
    const uploadedFile = await openai.files.create({
      file: new File([blob], file.name, { type: file.type }),
      purpose: 'assistants'
    });

    // 不需要创建vector store，直接返回文件信息
    return NextResponse.json({ 
      message: '文件上传成功',
      fileId: uploadedFile.id,
      fileName: file.name,
      uploadDate: new Date().toISOString()
    });
  } catch (error) {
    console.error('文件上传失败:', error);
    return NextResponse.json(
      { error: '文件上传失败', details: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    );
  }
} 