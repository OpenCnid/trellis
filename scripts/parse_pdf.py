import sys
import json
import traceback

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No file path provided"}))
        sys.exit(1)
        
    file_path = sys.argv[1]
    
    try:
        from unstructured.partition.pdf import partition_pdf
        elements = partition_pdf(filename=file_path, strategy="fast")
        
        elements_dict = [el.to_dict() for el in elements]
        print(json.dumps(elements_dict))
        
    except Exception as e:
        error_info = {
            "error": str(e),
            "traceback": traceback.format_exc()
        }
        print(json.dumps(error_info))
        sys.exit(1)

if __name__ == "__main__":
    main()
